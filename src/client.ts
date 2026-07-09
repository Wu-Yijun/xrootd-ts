import { XRootDUrl } from "./url/url.ts";
import { Transport } from "./transport/transport.ts";
import { Multiplexer } from "./transport/multiplexer.ts";
import type { DetachedRequest } from "./transport/multiplexer.ts";
import { connectToHost } from "./session/connect.ts";
import { File } from "./api/file.ts";
import { FileSystem } from "./api/filesystem.ts";
import type { Session } from "./session/handshake.ts";
import type { StatInfo } from "./api/types.ts";
import type { DirectoryList } from "./api/types.ts";
import { XRootDError } from "./api/errors.ts";
import { ClientError, OpenFlags } from "./protocol/constants.ts";
import type { SecEnv } from "./config/sec-env.ts";

const leakDetector = new FinalizationRegistry((leakInfo: { location: string }) => {
  console.warn(
    `[XRootD Warning] Resource Leak Detected: An XRootDClient for '${leakInfo.location}' ` +
      `was garbage collected without being closed. This will cause TCP socket leaks. ` +
      `Please ensure you call client.close() or use 'await using client = ...'.`,
  );
});

export interface XRootDClientOptions {
  credentials?: {
    username: string;
    password?: string;
  };
  timeout?: number;
  maxRedirects?: number;
  /** TLS configuration for roots:// connections. */
  tls?: {
    /** Whether to verify server certificate. Defaults to false. */
    rejectUnauthorized?: boolean;
  };
  /** Security environment configuration. Enables credential auto-discovery and protocol filtering. */
  secEnv?: SecEnv;
  /**
   * Whether to call socket.unref() so the connection doesn't keep the process alive.
   * @default false
   */
  unrefSockets?: boolean;
  /**
   * Idle timeout in milliseconds for the main control connection.
   * Socket is destroyed after this period of no data flow. Set to 0 to disable.
   * Note: File connections use this value as the default, but can be overridden per-file.
   * @default 30000
   */
  idleTimeout?: number;
}

export class XRootDClient {
  private readonly url: XRootDUrl;
  private readonly options: XRootDClientOptions;
  private transport: Transport | null = null;
  private mux: Multiplexer | null = null;
  private session: Session | null = null;
  private fs: FileSystem | null = null;
  private redirectCount = 0;
  private destroyed = false;

  constructor(url: string, options: XRootDClientOptions = {}) {
    this.url = XRootDUrl.parse(url);
    this.options = options;
  }

  async connect(): Promise<void> {
    await this.doConnect(this.url);
  }

  private async doConnect(url: XRootDUrl): Promise<void> {
    const conn = await connectToHost(url, {
      credentials: this.options.credentials,
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
      redirectCount: this.redirectCount,
      tls: this.options.tls,
      secEnv: this.options.secEnv,
      unrefSockets: this.options.unrefSockets,
      idleTimeout: this.options.idleTimeout,
      onRedirect: (host, port, pending) =>
        this.handleRedirect(host, port, pending),
    });

    this.transport = conn.transport;
    this.mux = conn.mux;
    this.session = conn.session;

    this.fs = new FileSystem(() => {
      if (!this.mux) {
        throw new XRootDError(
          ClientError.Uninitialized,
          "Client not connected",
        );
      }
      return this.mux;
    });

    leakDetector.register(this, { location: this.url.getLocation() });
  }

  private async handleRedirect(
    host: string,
    port: number,
    pending: DetachedRequest,
  ): Promise<void> {
    if (this.mux) {
      this.redirectCount = this.mux.getRedirectCount();
      this.mux.close();
      this.mux = null as Multiplexer | null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    this.session = null;
    this.fs = null;

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
      await this.doConnect(newUrl);

      let requestData = pending.data;
      if (opaqueQuery && requestData && requestData.length > 0) {
        const opaqueBytes = Buffer.from(opaqueQuery, "utf-8");
        const merged = new Uint8Array(requestData.length + opaqueBytes.length);
        merged.set(requestData);
        merged.set(opaqueBytes, requestData.length);
        requestData = merged;
      }

      if (!this.mux) {
        throw new XRootDError(
          ClientError.Uninitialized,
          "Client not connected after redirect",
        );
      }
      this.mux.request(pending.requestId, pending.body, requestData)
        .then(pending.resolve)
        .catch(pending.reject);
    } catch (err) {
      await this.close();
      pending.reject(err as Error);
    }
  }

  async open(
    path: string,
    options?: { flags?: number; mode?: number; idleTimeout?: number },
  ): Promise<File> {
    await this.ensureConnectedAsync();

    const file = new File({
      url: this.url,
      credentials: this.options.credentials,
      tls: this.options.tls,
      secEnv: this.options.secEnv,
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
      unrefSockets: this.options.unrefSockets,
      idleTimeout: options?.idleTimeout ?? this.options.idleTimeout,
    });
    await file.open(path, options);
    return file;
  }

  async stat(path: string): Promise<StatInfo> {
    await this.ensureConnectedAsync();

    const file = new File({
      url: this.url,
      credentials: this.options.credentials,
      tls: this.options.tls,
      secEnv: this.options.secEnv,
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
      unrefSockets: this.options.unrefSockets,
      idleTimeout: this.options.idleTimeout,
    });
    await file.open(path, { flags: OpenFlags.Read });
    try {
      return await file.stat();
    } finally {
      await file.close();
    }
  }

  async statFilesystem(path: string): Promise<StatInfo> {
    const fs = await this.ensureFileSystemAsync();
    return fs.stat(path);
  }

  async readdir(
    path: string,
    options?: { dstat?: boolean },
  ): Promise<DirectoryList> {
    const fs = await this.ensureFileSystemAsync();
    return fs.readdir(path, options);
  }

  async mkdir(path: string, mode?: number): Promise<void> {
    const fs = await this.ensureFileSystemAsync();
    return fs.mkdir(path, mode);
  }

  async rmdir(path: string): Promise<void> {
    const fs = await this.ensureFileSystemAsync();
    return fs.rmdir(path);
  }

  async rm(path: string): Promise<void> {
    const fs = await this.ensureFileSystemAsync();
    return fs.rm(path);
  }

  async mv(source: string, target: string): Promise<void> {
    const fs = await this.ensureFileSystemAsync();
    return fs.mv(source, target);
  }

  async close(): Promise<void> {
    this.destroyed = true;
    leakDetector.unregister(this);

    if (this.mux) {
      this.mux.close();
      this.mux = null;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    this.session = null;
    this.fs = null;
  }

  async [Symbol.asyncDispose]() {
    await this.close();
  }

  get isConnected(): boolean {
    return !this.destroyed && this.session !== null;
  }

  get location(): string {
    return this.url.getLocation();
  }

  private async ensureConnectedAsync(): Promise<Multiplexer> {
    if (this.destroyed) {
      throw new XRootDError(ClientError.Uninitialized, "Client has been closed");
    }

    if (this.mux && !this.mux.isClosed) {
      return this.mux;
    }

    console.debug("[XRootDClient] Main connection lost. Reconnecting...");
    await this.doConnect(this.url);

    if (!this.mux) {
      throw new XRootDError(
        ClientError.InternalError,
        "Failed to reconnect",
      );
    }
    return this.mux;
  }

  private async ensureFileSystemAsync(): Promise<FileSystem> {
    await this.ensureConnectedAsync();
    if (!this.fs) {
      throw new XRootDError(ClientError.Uninitialized, "Client not connected");
    }
    return this.fs;
  }
}
