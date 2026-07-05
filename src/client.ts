import { XRootDUrl } from "./url/url.ts";
import { Transport } from "./transport/transport.ts";
import { Multiplexer } from "./transport/multiplexer.ts";
import { handshake } from "./session/handshake.ts";
import { doAuthentication, registerAuthProtocol } from "./session/auth.ts";
import { HostAuth } from "./security/host.ts";
import { SSSAuth } from "./security/sss.ts";
import { File } from "./api/file.ts";
import { FileSystem } from "./api/filesystem.ts";
import type { Session } from "./session/handshake.ts";
import type { StatInfo } from "./api/types.ts";
import type { DirectoryList } from "./api/types.ts";
import { XRootDError } from "./api/errors.ts";
import { ClientError, OpenFlags, RequestId } from "./protocol/constants.ts";
import { buildEndsessRequest } from "./protocol/message.ts";
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
      onRedirect: (host, port) => this.handleRedirect(host, port),
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
    if (authConfig.sssKey && SSSAuth.isSupported()) {
      registerAuthProtocol("sss", () => new SSSAuth(authConfig.sssKey!));
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
        },
        { protocolFilter: secEnv?.protocolFilter },
      );
      this.session.secEntity = secEntity;
    }

    this.fs = new FileSystem(this.mux);
  }

  private async handleRedirect(host: string, port: number): Promise<void> {
    // End old session if exists
    if (this.session && this.mux) {
      try {
        const endsessBody = buildEndsessRequest(0, this.session.sessid);
        await this.mux.request(RequestId.Endsess, new Uint8Array(endsessBody));
      } catch {
        // Ignore endsess errors (old session may have expired)
      }
    }

    // Close old connection
    if (this.mux) {
      this.mux.close();
      this.mux = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    // Connect to new host
    const newUrl = XRootDUrl.parse(`root://${host}:${port}`);
    await this.doConnect(newUrl);
  }

  async open(
    path: string,
    options?: { flags?: number; mode?: number },
  ): Promise<File> {
    this.ensureConnected();

    const file = new File(this.mux!, this.session!);
    await file.open(path, options);
    return file;
  }

  async stat(path: string): Promise<StatInfo> {
    this.ensureConnected();

    const file = new File(this.mux!, this.session!);
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
