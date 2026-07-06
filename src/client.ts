import { XRootDUrl } from "./url/url.ts";
import { Transport } from "./transport/transport.ts";
import { Multiplexer } from "./transport/multiplexer.ts";
import type { DetachedRequest } from "./transport/multiplexer.ts";
import { handshake } from "./session/handshake.ts";
import { doAuthentication, registerAuthProtocol } from "./session/auth.ts";
import { HostAuth } from "./security/host.ts";
import { SSSAuth } from "./security/sss.ts";
import { UnixAuth } from "./security/unix.ts";
import { Krb5Auth } from "./security/krb5.ts";
import { File } from "./api/file.ts";
import { FileSystem } from "./api/filesystem.ts";
import type { Session } from "./session/handshake.ts";
import type { StatInfo } from "./api/types.ts";
import type { DirectoryList } from "./api/types.ts";
import { XRootDError } from "./api/errors.ts";
import { ClientError, OpenFlags } from "./protocol/constants.ts";
import type { SecEnv } from "./config/sec-env.ts";
import { loadAuthConfig } from "./config/loader.ts";

export interface XRootDClientOptions {
  credentials?: {
    username: string;
    password?: string;
  };
  timeout?: number;
  maxRedirects?: number;
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
    this.transport = new Transport();
    await this.transport.connect(url.host, url.port);

    this.mux = new Multiplexer(this.transport, {
      maxRedirects: this.options.maxRedirects ?? 16,
      redirectCount: this.redirectCount,
      onRedirect: (host, port, pending) => this.handleRedirect(host, port, pending),
    });

    if (this.options.timeout) {
      this.mux.setTimeout(this.options.timeout);
    }

    this.session = await handshake(this.mux, url, {
      username: this.options.credentials?.username,
    });

    const secEnv = this.options.secEnv;
    const authConfig = loadAuthConfig({
      url,
      credentials: this.options.credentials,
      secEnv,
    });

    // Register supported authentication protocols
    registerAuthProtocol("host", () => new HostAuth());
    registerAuthProtocol("unix", () => new UnixAuth());
    if (authConfig.sssKey && SSSAuth.isSupported()) {
      registerAuthProtocol("sss", () => new SSSAuth(authConfig.sssKey!));
    }
    if (Krb5Auth.isSupported()) {
      registerAuthProtocol("krb5", () => new Krb5Auth());
    }

    // Perform authentication if server requires it (login response had secToken)
    if (this.session.needsAuth && this.session.authProtocols?.length) {
      const secEntity = await doAuthentication(
        this.mux,
        this.session.authProtocols,
        {
          host: url.host,
          port: url.port,
          username: authConfig.username,
          password: authConfig.password,
          sessid: this.session.sessid,
          spnPrefix: this.session.spnPrefix,
        },
        { protocolFilter: secEnv?.protocolFilter },
      );
      this.session.secEntity = secEntity;
    }

    this.fs = new FileSystem(() => this.mux!);
  }

  private async handleRedirect(host: string, port: number, pending: DetachedRequest): Promise<void> {
    // Capture accumulated redirect count before destroying old mux
    if (this.mux) {
      this.redirectCount = this.mux.getRedirectCount();
      this.mux.close();
      this.mux = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    // CRITICAL: Nullify old state so we don't use stale objects if reconnection fails
    this.session = null;
    this.fs = null;

    // Parse opaque query string (capability tokens) from the redirect host.
    // Server returns e.g. "eos07.ihep.ac.cn?&cap.sym=...&cap.msg=..."
    let urlStr: string;
    let opaqueQuery = "";
    const qIndex = host.indexOf('?');
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

      // Append opaque data (capability tokens) to the request payload (file path).
      // This mirrors C++ RewriteCGIAndPath() which merges redirect URL params
      // into the request path so data nodes can verify authorization.
      let requestData = pending.data;
      if (opaqueQuery && requestData && requestData.length > 0) {
        const opaqueBytes = Buffer.from(opaqueQuery, "utf-8");
        const merged = new Uint8Array(requestData.length + opaqueBytes.length);
        merged.set(requestData);
        merged.set(opaqueBytes, requestData.length);
        requestData = merged;
      }

      this.mux!.request(pending.requestId, pending.body, requestData)
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

    const file = new File(() => this.mux!);
    await file.open(path, options);
    return file;
  }

  async stat(path: string): Promise<StatInfo> {
    this.ensureConnected();

    const file = new File(() => this.mux!);
    await file.open(path, { flags: OpenFlags.Read });
    try {
      return await file.stat();
    } finally {
      await file.close();
    }
  }

  async statFilesystem(path: string): Promise<StatInfo> {
    this.ensureFileSystem();
    return this.fs!.stat(path);
  }

  async readdir(path: string): Promise<DirectoryList> {
    this.ensureFileSystem();
    return this.fs!.readdir(path);
  }

  async mkdir(path: string, mode?: number): Promise<void> {
    this.ensureFileSystem();
    return this.fs!.mkdir(path, mode);
  }

  async rmdir(path: string): Promise<void> {
    this.ensureFileSystem();
    return this.fs!.rmdir(path);
  }

  async rm(path: string): Promise<void> {
    this.ensureFileSystem();
    return this.fs!.rm(path);
  }

  async mv(source: string, target: string): Promise<void> {
    this.ensureFileSystem();
    return this.fs!.mv(source, target);
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

  private ensureConnected(): void {
    if (!this.mux || !this.session) {
      throw new XRootDError(ClientError.Uninitialized, "Client not connected");
    }
  }

  private ensureFileSystem(): void {
    if (!this.fs) {
      throw new XRootDError(ClientError.Uninitialized, "Client not connected");
    }
  }
}
