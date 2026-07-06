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
}

export class XRootDClient {
  private readonly url: XRootDUrl;
  private readonly options: XRootDClientOptions;
  private transport: Transport | null = null;
  private mux: Multiplexer | null = null;
  private session: Session | null = null;
  private fs: FileSystem | null = null;
  private redirectCount = 0;

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
    options?: { flags?: number; mode?: number },
  ): Promise<File> {
    this.ensureConnected();

    const file = new File({
      url: this.url,
      credentials: this.options.credentials,
      tls: this.options.tls,
      secEnv: this.options.secEnv,
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
    });
    await file.open(path, options);
    return file;
  }

  async stat(path: string): Promise<StatInfo> {
    this.ensureConnected();

    const file = new File({
      url: this.url,
      credentials: this.options.credentials,
      tls: this.options.tls,
      secEnv: this.options.secEnv,
      timeout: this.options.timeout,
      maxRedirects: this.options.maxRedirects,
    });
    await file.open(path, { flags: OpenFlags.Read });
    try {
      return await file.stat();
    } finally {
      await file.close();
    }
  }

  async statFilesystem(path: string): Promise<StatInfo> {
    return this.ensureFileSystem().stat(path);
  }

  async readdir(
    path: string,
    options?: { dstat?: boolean },
  ): Promise<DirectoryList> {
    return this.ensureFileSystem().readdir(path, options);
  }

  async mkdir(path: string, mode?: number): Promise<void> {
    return this.ensureFileSystem().mkdir(path, mode);
  }

  async rmdir(path: string): Promise<void> {
    return this.ensureFileSystem().rmdir(path);
  }

  async rm(path: string): Promise<void> {
    return this.ensureFileSystem().rm(path);
  }

  async mv(source: string, target: string): Promise<void> {
    return this.ensureFileSystem().mv(source, target);
  }

  async close(): Promise<void> {
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

  get isConnected(): boolean {
    return this.session !== null;
  }

  get location(): string {
    return this.url.getLocation();
  }

  private ensureConnected(): Multiplexer {
    if (!this.mux || !this.session) {
      throw new XRootDError(ClientError.Uninitialized, "Client not connected");
    }
    return this.mux;
  }

  private ensureFileSystem(): FileSystem {
    if (!this.fs) {
      throw new XRootDError(ClientError.Uninitialized, "Client not connected");
    }
    return this.fs;
  }
}
