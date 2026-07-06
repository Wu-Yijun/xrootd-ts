import { DEFAULT_PORT } from "../protocol/constants.ts";

export class XRootDUrl {
  readonly protocol: string;
  readonly user?: string;
  readonly password?: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;

  constructor(url: string) {
    const normalized = url.startsWith("root://") || url.startsWith("roots://")
      ? url
      : `root://${url}`;

    const parsed = new URL(normalized);

    const protocol = parsed.protocol.replace(/:$/, "");
    if (protocol !== "root" && protocol !== "roots") {
      throw new Error(`Invalid XRootD URL protocol: ${protocol}`);
    }

    this.protocol = protocol;
    this.host = parsed.hostname;
    this.port = parsed.port ? parseInt(parsed.port, 10) : DEFAULT_PORT;
    this.path = parsed.pathname || "/";
    this.user = parsed.username || undefined;
    this.password = parsed.password || undefined;
  }

  static parse(url: string): XRootDUrl {
    return new XRootDUrl(url);
  }

  toString(): string {
    const auth = this.getAuthString();
    const portStr = this.port === DEFAULT_PORT ? "" : `:${this.port}`;
    return `${this.protocol}://${auth}${this.host}${portStr}${this.path}`;
  }

  isValid(): boolean {
    return this.protocol === "root" || this.protocol === "roots";
  }

  isSecure(): boolean {
    return this.protocol === "roots";
  }

  getHostId(): string {
    const auth = this.getAuthString();
    return `${auth}${this.host}:${this.port}`;
  }

  getChannelId(): string {
    return `${this.host}:${this.port}`;
  }

  getLocation(): string {
    return `${this.protocol}://${this.host}:${this.port}${this.path}`;
  }

  private getAuthString(): string {
    if (!this.user) return "";
    let auth = this.user;
    if (this.password) {
      auth += ":" + this.password;
    }
    return auth + "@";
  }
}
