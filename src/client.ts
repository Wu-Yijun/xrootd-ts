import type { XRootDClientOptions, FileHandle, FileStatus, RedirectInfo, QueryResult } from "./types.js";

export class XRootDClient {
  private readonly host: string;
  private readonly port: number;
  private readonly options: XRootDClientOptions;

  constructor(url: string, options: XRootDClientOptions = {}) {
    const parsed = this.parseUrl(url);
    this.host = parsed.host;
    this.port = parsed.port;
    this.options = options;
  }

  private parseUrl(url: string): { host: string; port: number } {
    const match = url.match(/^root:\/\/([^:]+)(?::(\d+))?/);
    if (!match) {
      throw new Error(`Invalid XRootD URL: ${url}`);
    }
    return {
      host: match[1],
      port: match[2] ? parseInt(match[2], 10) : 1094,
    };
  }

  async open(path: string, flags?: number): Promise<FileHandle> {
    throw new Error("Not implemented");
  }

  async close(handle: FileHandle): Promise<void> {
    throw new Error("Not implemented");
  }

  async read(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
    throw new Error("Not implemented");
  }

  async write(handle: FileHandle, offset: number, data: Uint8Array): Promise<number> {
    throw new Error("Not implemented");
  }

  async stat(path: string): Promise<FileStatus> {
    throw new Error("Not implemented");
  }

  async mkdir(path: string, mode?: number): Promise<void> {
    throw new Error("Not implemented");
  }

  async rm(path: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async query(code: number, data?: Uint8Array): Promise<QueryResult> {
    throw new Error("Not implemented");
  }
}
