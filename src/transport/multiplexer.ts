import type { ITransport } from "./interface.ts";
import { type Frame, Framer } from "./framer.ts";
import { Message } from "../protocol/message.ts";
import {
  AttnAction,
  ClientError,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT,
  MAX_STREAM_ID,
  MS_PER_SEC,
  ResponseStatus,
} from "../protocol/constants.ts";
import { parseRedirectResponse } from "../protocol/message.ts";
import { bytesToStreamId, streamIdToBytes } from "../utils/bytes.ts";
import { XRootDError } from "../api/errors.ts";

interface PendingRequest {
  resolve: (frame: Frame) => void;
  reject: (err: Error) => void;
  expiresAt: number;
  requestId: number;
  body: Uint8Array;
  data?: Uint8Array;
}

export interface DetachedRequest {
  resolve: (frame: Frame) => void;
  reject: (err: Error) => void;
  requestId: number;
  body: Uint8Array;
  data?: Uint8Array;
}

export interface MultiplexerOptions {
  maxRedirects?: number;
  redirectCount?: number;
  onRedirect?: (
    host: string,
    port: number,
    pending: DetachedRequest,
  ) => Promise<void>;
}

/**
 * Layer 3 Multiplexer
 *
 * Maintains streamId → Promise mapping.
 * Generates incremental stream IDs, stores pending requests in Map,
 * resolves when Framer delivers matching response frames.
 */
export class Multiplexer {
  private transport: ITransport;
  private framer: Framer;
  private pending = new Map<number, PendingRequest>();
  private nextStreamId = 1; // 0 is reserved for control frames (handshake)
  private timeout = DEFAULT_TIMEOUT;
  private sweepTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private closed = false;
  private redirectCount = 0;
  private maxRedirects: number;
  private onRedirect?: (
    host: string,
    port: number,
    pending: DetachedRequest,
  ) => Promise<void>;
  private controlQueue: Frame[] = [];
  private controlWaiters: Array<{
    resolve: (frame: Frame) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(transport: ITransport, options?: MultiplexerOptions) {
    this.transport = transport;
    this.framer = new Framer();
    this.maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.redirectCount = options?.redirectCount ?? 0;
    this.onRedirect = options?.onRedirect;

    this.sweepTimer = globalThis.setInterval(
      () => this.sweepTimeouts(),
      MS_PER_SEC,
    );
    this.sweepTimer.unref();

    this.transport.onData((chunk) => {
      const frames = this.framer.feed(chunk);
      for (const frame of frames) {
        this.handleFrame(frame);
      }
    });

    this.transport.onClose(() => {
      this.rejectAll(new Error("Connection closed"));
    });

    this.transport.onError((err) => {
      this.rejectAll(err);
    });
  }

  private allocateStreamId(): number {
    let sid = this.nextStreamId;
    while (this.pending.has(sid)) {
      sid = (sid + 1) & MAX_STREAM_ID;
      if (sid === this.nextStreamId) {
        throw new XRootDError(
          ClientError.InternalError,
          "Max concurrent requests (65535) reached",
        );
      }
    }
    this.nextStreamId = (sid + 1) & MAX_STREAM_ID;
    return sid;
  }

  async request(
    requestId: number,
    body: Uint8Array,
    data?: Uint8Array,
  ): Promise<Frame> {
    if (this.closed) {
      throw new XRootDError(ClientError.InternalError, "Multiplexer is closed");
    }

    const sid = this.allocateStreamId();

    const bodyBuf = Buffer.alloc(16);
    Buffer.from(body).copy(bodyBuf);

    const msg = new Message(24 + (data?.length ?? 0));
    msg.writeBytes(streamIdToBytes(sid));
    msg.writeInt16BE(requestId);
    msg.writeBytes(bodyBuf);
    msg.writeInt32BE(data?.length ?? 0);
    if (data && data.length > 0) {
      msg.writeBytes(data);
    }

    return new Promise<Frame>((resolve, reject) => {
      this.pending.set(sid, {
        resolve,
        reject,
        expiresAt: Date.now() + this.timeout,
        requestId,
        body,
        data,
      });
      this.transport.send(msg.getBuffer()).catch(reject);
    });
  }

  private handleFrame(frame: Frame): void {
    const sid = bytesToStreamId(frame.streamId);

    // Control frames (streamId=0) — used during handshake and protocol negotiation.
    // Route to control queue/waiters instead of pending map.
    if (sid === 0) {
      if (this.controlWaiters.length > 0) {
        this.controlWaiters.shift()!.resolve(frame);
      } else {
        this.controlQueue.push(frame);
      }
      return;
    }

    // Intercept kXR_attn (4001) responses — these carry async results
    if (frame.status === ResponseStatus.Attn) {
      this.handleAttnResponse(frame);
      return;
    }

    if (frame.status === ResponseStatus.Wait) {
      // kXR_wait: server is busy, client MUST retry later
      this.handleWaitResponse(sid, frame, true);
      return;
    }

    if (frame.status === ResponseStatus.Waitresp) {
      // kXR_waitresp: server is processing, client MUST NOT retry
      this.handleWaitResponse(sid, frame, false);
      return;
    }

    if (frame.status === ResponseStatus.Redirect) {
      this.handleRedirectResponse(sid, frame);
      return;
    }

    const pending = this.pending.get(sid);
    if (!pending) return;
    this.pending.delete(sid);
    pending.resolve(frame);
  }

  /**
   * Handle kXR_attn (4001) response.
   *
   * When action code is kXR_asynresp (5008), the body contains an embedded
   * response header with the original streamId and status:
   *
   * Body layout (offsets from body start):
   *   actnum[4]     - action code (5008 = kXR_asynresp)
   *   reserved[4]   - zeros
   *   streamid[2]   - original request's streamId
   *   status[2]     - actual response status
   *   dlen[4]       - response body length
   *   respdata[N]   - response body (may be empty)
   */
  private handleAttnResponse(frame: Frame): void {
    if (frame.body.length < 16) return;

    const actnum = frame.body.readUInt32BE(0);
    if (actnum !== AttnAction.AsyncResp) return;

    const origSid = frame.body.readUInt16BE(8);
    const innerStatus = frame.body.readUInt16BE(10);
    const innerDlen = frame.body.readUInt32BE(12);

    const pending = this.pending.get(origSid);
    if (!pending) return;
    this.pending.delete(origSid);

    // Resolve with a synthetic frame containing the embedded response
    const innerBody = innerDlen > 0
      ? frame.body.subarray(16, 16 + innerDlen)
      : Buffer.alloc(0);

    pending.resolve({
      streamId: frame.body.subarray(8, 10),
      status: innerStatus,
      dlen: innerDlen,
      body: innerBody,
    });
  }

  private handleWaitResponse(
    sid: number,
    frame: Frame,
    shouldRetry: boolean,
  ): void {
    const seconds = frame.body.readInt32BE(0);
    const pending = this.pending.get(sid);
    if (pending) {
      pending.expiresAt = Date.now() + seconds * MS_PER_SEC + this.timeout;
      if (shouldRetry) {
        // kXR_wait: server is busy, retry after the specified delay
        globalThis.setTimeout(
          () => this.retryRequest(sid),
          seconds * MS_PER_SEC,
        );
      }
      // kXR_waitresp: server is processing, do NOT retry.
      // Wait for the kXR_attn async response to arrive.
    }
  }

  private handleRedirectResponse(sid: number, frame: Frame): void {
    const pending = this.pending.get(sid);
    if (!pending) return;

    // Detach: remove from pending WITHOUT rejecting
    this.pending.delete(sid);

    if (this.redirectCount >= this.maxRedirects) {
      pending.reject(
        new Error(
          `Too many redirects (max ${this.maxRedirects})`,
        ),
      );
      return;
    }

    this.redirectCount++;
    const { host, port } = parseRedirectResponse(frame.body);

    if (this.onRedirect) {
      this.onRedirect(host, port, {
        resolve: pending.resolve,
        reject: pending.reject,
        requestId: pending.requestId,
        body: pending.body,
        data: pending.data,
      }).catch((err) => {
        pending.reject(err);
      });
    } else {
      pending.reject(
        new Error(
          `Redirect to ${host}:${port} but no onRedirect handler configured`,
        ),
      );
    }
  }

  private retryRequest(sid: number): void {
    const pending = this.pending.get(sid);
    if (!pending) return;
    this.pending.delete(sid);
    this.request(pending.requestId, pending.body, pending.data)
      .then(pending.resolve)
      .catch(pending.reject);
  }

  private sweepTimeouts(): void {
    const now = Date.now();
    for (const [sid, req] of this.pending.entries()) {
      if (now > req.expiresAt) {
        this.pending.delete(sid);
        req.reject(new Error(`Request timeout: streamid=${sid}`));
      }
    }
  }

  setTimeout(ms: number): void {
    this.timeout = ms;
  }

  resetRedirectCount(): void {
    this.redirectCount = 0;
  }

  getRedirectCount(): number {
    return this.redirectCount;
  }

  updateRedirectHandler(
    handler: (host: string, port: number, pending: DetachedRequest) => Promise<void>,
  ): void {
    this.onRedirect = handler;
  }

  getTransport(): ITransport {
    return this.transport;
  }

  /**
   * Read the next control frame (streamId=0).
   * Used during handshake to read ServerInitHandShake, Protocol, and Login
   * responses without a separate onData handler.
   */
  nextControlFrame(): Promise<Frame> {
    if (this.controlQueue.length > 0) {
      return Promise.resolve(this.controlQueue.shift()!);
    }
    return new Promise<Frame>((resolve, reject) => {
      this.controlWaiters.push({ resolve, reject });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.sweepTimer) {
      globalThis.clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    this.rejectAll(new Error("Multiplexer closed"));

    // Reject pending control frame waiters (e.g. handshake awaiting response)
    const err = new Error("Multiplexer closed");
    for (const waiter of this.controlWaiters) {
      waiter.reject(err);
    }
    this.controlWaiters.length = 0;
    this.controlQueue.length = 0;
  }

  private rejectAll(err: Error): void {
    for (const [, req] of this.pending.entries()) {
      req.reject(err);
    }
    this.pending.clear();
  }
}
