export interface XRootDClientOptions {
  /** Authentication credentials */
  credentials?: {
    username: string;
    password?: string;
  };
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Number of redirect attempts */
  maxRedirects?: number;
}

export interface FileHandle {
  /** Unique file handle identifier */
  readonly handle: number;
  /** Whether the file is open for reading */
  readonly readable: boolean;
  /** Whether the file is open for writing */
  readonly writable: boolean;
}

export interface FileStatus {
  /** File ID */
  id: number;
  /** File size in bytes */
  size: number;
  /** Modification time (Unix timestamp) */
  mtime: number;
  /** File flags */
  flags: number;
}

export interface RedirectInfo {
  /** Redirect host */
  host: string;
  /** Redirect port */
  port: number;
  /** Whether authentication is required */
  requiresAuth: boolean;
}

export interface QueryResult {
  /** Query code */
  code: number;
  /** Query data */
  data: Uint8Array;
}
