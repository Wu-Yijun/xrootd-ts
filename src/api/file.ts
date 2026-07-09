import { Transport } from "../transport/transport.ts";
import { Multiplexer } from "../transport/multiplexer.ts";
import type { DetachedRequest } from "../transport/multiplexer.ts";
import { connectToHost } from "../session/connect.ts";
import {
  buildCloseRequest,
  buildOpenRequest,
  buildReadRequest,
  buildStatRequest,
  buildSyncRequest,
  buildTruncateRequest,
  buildWriteRequest,
  parseOpenResponse,
} from "../protocol/message.ts";
import { parseRedirectResponse } from "../protocol/message.ts";
import {
  ClientError,
  OpenFlags,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import { assertOkFrame, XRootDError } from "./errors.ts";
import { createStatInfo, type StatInfo } from "./types.ts";
import { sendRequest } from "../utils/request.ts";
import { XRootDUrl } from "../url/url.ts";
import type { SecEnv } from "../config/sec-env.ts";

export interface FileConnectionOptions {
  url: XRootDUrl;
  credentials?: { username: string; password?: string };
  tls?: { rejectUnauthorized?: boolean };
  secEnv?: SecEnv;
  timeout?: number;
  maxRedirects?: number;
  /**
   * Whether to call socket.unref() so the connection doesn't keep the process alive.
   * @default false
   */
  unrefSockets?: boolean;
  /**
   * Idle timeout in milliseconds. Socket is destroyed after this period of no data flow.
   * Set to 0 to disable (not recommended, requires manual close).
   * @default 30000
   */
  idleTimeout?: number;
}

const leakDetector = new FinalizationRegistry((leakInfo: { path: string }) => {
  console.warn(
    `[XRootD Warning] Resource Leak Detected: A File instance for '${leakInfo.path}' ` +
    `was garbage collected without being closed. This will cause TCP socket leaks. ` +
    `Please ensure you call file.close() or use 'await using file = ...'.`
  );
});

export class File {
  private readonly options: FileConnectionOptions;
  private transport: Transport | null = null;
  private mux: Multiplexer | null = null;
  private fhandle: Uint8Array | null = null;
  private _isOpen = false;
  private pendingOperations = 0;
  private isClosed = false;

  constructor(options: FileConnectionOptions) {
    this.options = options;

  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async open(
    path: string,
    options?: { flags?: number; mode?: number; idleTimeout?: number },
  ): Promise<void> {
    if (this._isOpen) {
      throw new XRootDError(ServerError.FileNotOpen, "File is already open");
    }

    const flags = options?.flags ?? OpenFlags.Read;
    const mode = options?.mode ?? 0;

    try {
      if (!this.mux) {
        const conn = await connectToHost(this.options.url, {
          credentials: this.options.credentials,
          tls: this.options.tls,
          secEnv: this.options.secEnv,
          timeout: this.options.timeout,
          maxRedirects: this.options.maxRedirects,
          unrefSockets: this.options.unrefSockets,
          idleTimeout: options?.idleTimeout ?? this.options.idleTimeout,
          onRedirect: (host, port, pending) =>
            this.handleRedirect(host, port, pending),
        });
        this.transport = conn.transport;
        this.mux = conn.mux;
      }

      const buf = buildOpenRequest(0, path, flags, mode);
      const frame = await sendRequest(this.mux, buf, Buffer.from(path));

      assertOkFrame(frame);

      if (frame.status === ResponseStatus.Ok) {
        const resp = parseOpenResponse(frame.body);
        this.fhandle = resp.fhandle;
        this._isOpen = true;

        // 注册泄漏检测。注意：不要将 `this` 传给 registry，否则会导致无法被 GC
        leakDetector.register(this, { path }, this);
        return;
      }

      throw new XRootDError(
        ServerError.ServerError,
        `Unexpected open response status: ${frame.status}`,
      );
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  private async handleRedirect(
    host: string,
    port: number,
    pending: DetachedRequest,
  ): Promise<void> {
    if (this.mux) {
      this.mux.close();
      this.mux = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    let urlStr: string;
    let opaqueQuery = "";
    const qIndex = host.indexOf("?");
    if (qIndex !== -1) {
      const hostname = host.substring(0, qIndex);
      opaqueQuery = host.substring(qIndex);
      urlStr = `root://${hostname}:${port}${opaqueQuery}`;
    } else {
      urlStr = `root://${host}:${port}`;
    }

    const newUrl = XRootDUrl.parse(urlStr);

    try {
      const conn = await connectToHost(newUrl, {
        credentials: this.options.credentials,
        tls: this.options.tls,
        secEnv: this.options.secEnv,
        timeout: this.options.timeout,
        maxRedirects: this.options.maxRedirects,
        unrefSockets: this.options.unrefSockets,
        idleTimeout: this.options.idleTimeout,
        onRedirect: (h, p, p2) => this.handleRedirect(h, p, p2),
      });
      this.transport = conn.transport;
      this.mux = conn.mux;

      let requestData = pending.data;
      if (opaqueQuery && requestData && requestData.length > 0) {
        const opaqueBytes = Buffer.from(opaqueQuery, "utf-8");
        const merged = new Uint8Array(requestData.length + opaqueBytes.length);
        merged.set(requestData);
        merged.set(opaqueBytes, requestData.length);
        requestData = merged;
      }

      this.mux.request(pending.requestId, pending.body, requestData)
        .then(pending.resolve)
        .catch(pending.reject);
    } catch (err) {
      this.cleanup();
      pending.reject(err as Error);
    }
  }

  private cleanup(): void {
    leakDetector.unregister(this);
    this.isClosed = true;

    if (this.mux) {
      this.mux.close();
      this.mux = null;
    }
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.fhandle = null;
    this._isOpen = false;
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (this.isClosed) {
      throw new XRootDError(ServerError.FileNotOpen, "File is closed");
    }

    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    this.pendingOperations++;
    try {
      const buf = buildReadRequest(0, this.fhandle, offset, size);
      const frame = await sendRequest(this.mux!, buf);

      assertOkFrame(frame);

      if (
        frame.status === ResponseStatus.Ok ||
        frame.status === ResponseStatus.Oksofar
      ) {
        return new Uint8Array(frame.body);
      }

      throw new XRootDError(
        ServerError.ServerError,
        `Unexpected read response status: ${frame.status}`,
      );
    } finally {
      this.pendingOperations--;
    }
  }

  async write(offset: number, data: Uint8Array): Promise<number> {
    if (this.isClosed) {
      throw new XRootDError(ServerError.FileNotOpen, "File is closed");
    }

    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    this.pendingOperations++;
    try {
      const buf = buildWriteRequest(0, this.fhandle, offset, data);
      const frame = await sendRequest(this.mux!, buf, data);

      assertOkFrame(frame);

      if (frame.status === ResponseStatus.Ok) {
        return frame.dlen > 0 ? frame.dlen : data.length;
      }

      throw new XRootDError(
        ServerError.ServerError,
        `Unexpected write response status: ${frame.status}`,
      );
    } finally {
      this.pendingOperations--;
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    if (this.pendingOperations > 0) {
      const errMsg = `[XRootD Client] Warning: file.close() called but there are ${this.pendingOperations} pending operations! Did you forget to 'await' a file.write()?`;
      throw new XRootDError(ClientError.InternalError, errMsg);
    }

    this.isClosed = true;

    if (!this._isOpen || !this.fhandle) {
      return;
    }

    const buf = buildCloseRequest(0, this.fhandle);
    const frame = await sendRequest(this.mux!, buf);

    this.fhandle = null;
    this._isOpen = false;

    assertOkFrame(frame);

    this.cleanup();
  }

  // 实现 asyncDispose 接口
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  async stat(): Promise<StatInfo> {
    if (this.isClosed) {
      throw new XRootDError(ServerError.FileNotOpen, "File is closed");
    }

    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    this.pendingOperations++;
    try {
      const buf = buildStatRequest(0, "", this.fhandle);
      const frame = await sendRequest(this.mux!, buf);

      assertOkFrame(frame);

      if (frame.status === ResponseStatus.Ok) {
        return parseStatInfo(frame.body);
      }

      throw new XRootDError(
        ServerError.ServerError,
        `Unexpected stat response status: ${frame.status}`,
      );
    } finally {
      this.pendingOperations--;
    }
  }

  async sync(): Promise<void> {
    if (this.isClosed) {
      throw new XRootDError(ServerError.FileNotOpen, "File is closed");
    }

    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    this.pendingOperations++;
    try {
      const buf = buildSyncRequest(0, this.fhandle);
      const frame = await sendRequest(this.mux!, buf);

      assertOkFrame(frame);
    } finally {
      this.pendingOperations--;
    }
  }

  async truncate(size: number): Promise<void> {
    if (this.isClosed) {
      throw new XRootDError(ServerError.FileNotOpen, "File is closed");
    }

    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    this.pendingOperations++;
    try {
      const buf = buildTruncateRequest(0, this.fhandle, size);
      const frame = await sendRequest(this.mux!, buf);

      assertOkFrame(frame);
    } finally {
      this.pendingOperations--;
    }
  }
}

function parseStatInfo(body: Buffer): StatInfo {
  return createStatInfo(body.toString("utf-8"));
}
