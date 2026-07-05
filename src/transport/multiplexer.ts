import type { ITransport } from "./interface.ts";
import { type Frame, Framer } from "./framer.ts";
import { Message } from "../protocol/message.ts";
import { ClientError, ResponseStatus } from "../protocol/constants.ts";
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

export interface MultiplexerOptions {
  maxRedirects?: number;
  onRedirect?: (host: string, port: number) => Promise<void>;
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
  private nextStreamId = 0;
  private timeout = 30000;
  private sweepTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private closed = false;
  private redirectCount = 0;
  private maxRedirects: number;
  private onRedirect?: (host: string, port: number) => Promise<void>;

  constructor(transport: ITransport, options?: MultiplexerOptions) {
    this.transport = transport;
    this.framer = new Framer();
    this.maxRedirects = options?.maxRedirects ?? 16;
    this.onRedirect = options?.onRedirect;

    this.sweepTimer = globalThis.setInterval(() => this.sweepTimeouts(), 1000);
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
      sid = (sid + 1) & 0xffff;
      if (sid === this.nextStreamId) {
        throw new XRootDError(
          ClientError.InternalError,
          "Max concurrent requests (65535) reached",
        );
      }
    }
    this.nextStreamId = (sid + 1) & 0xffff;
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

    if (
      frame.status === ResponseStatus.Wait ||
      frame.status === ResponseStatus.Waitresp
    ) {
      this.handleWaitResponse(sid, frame);
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

  private handleWaitResponse(sid: number, frame: Frame): void {
    const seconds = frame.body.readInt32BE(0);
    const pending = this.pending.get(sid);
    if (pending) {
      pending.expiresAt = Date.now() + seconds * 1000 + this.timeout;
      globalThis.setTimeout(() => this.retryRequest(sid), seconds * 1000);
    }
  }

  private handleRedirectResponse(sid: number, frame: Frame): void {
    const pending = this.pending.get(sid);
    if (!pending) return;

    if (this.redirectCount >= this.maxRedirects) {
      this.pending.delete(sid);
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
      this.onRedirect(host, port)
        .then(() => {
          this.retryRequest(sid);
        })
        .catch((err) => {
          this.pending.delete(sid);
          pending.reject(err);
        });
    } else {
      this.pending.delete(sid);
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

  getTransport(): ITransport {
    return this.transport;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.sweepTimer) {
      globalThis.clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    this.rejectAll(new Error("Multiplexer closed"));
  }

  private rejectAll(err: Error): void {
    for (const [, req] of this.pending.entries()) {
      req.reject(err);
    }
    this.pending.clear();
  }
}
