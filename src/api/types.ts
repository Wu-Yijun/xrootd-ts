import type { OpenFlags } from "../protocol/constants.ts";
import { S_IFDIR, S_IFLNK } from "../protocol/constants.ts";

export interface OpenOptions {
  flags?: OpenFlags;
  mode?: number;
  signal?: AbortSignal;
}

export interface StatInfo {
  id: number;
  size: number;
  mtime: number;
  mode: number;
  get isDirectory(): boolean;
  get isLink(): boolean;
  get isOffline(): boolean;
  get isCached(): boolean;
}

export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/);
  const id = parseInt(parts[0] ?? "0", 10) || 0;
  const size = parseInt(parts[1] ?? "0", 10) || 0;
  const mtime = parseInt(parts[3] ?? "0", 10) || 0;
  const modeStr = parts[6] ?? "0";
  const mode = parseInt(modeStr, 8) || 0;

  return {
    id,
    size,
    mtime,
    mode,
    get isDirectory() {
      return (mode & S_IFDIR) !== 0;
    },
    get isLink() {
      return (mode & S_IFLNK) === S_IFLNK;
    },
    get isOffline() {
      return false;
    },
    get isCached() {
      return false;
    },
  };
}

export interface ChunkInfo {
  fhandle: Uint8Array;
  offset: number;
  length: number;
  data?: Uint8Array;
}

export interface Location {
  host: string;
  port: number;
}

export interface LocationInfo {
  locations: Location[];
  get isServer(): boolean;
  get isManager(): boolean;
  get isRedirect(): boolean;
}

export interface DirectoryList {
  name: string;
  entries: DirectoryEntry[];
}

export interface ProtocolInfo {
  version: number;
  flags: number;
}

export interface AuthConfig {
  username?: string;
  password?: string;
  protocol?: string;
}

export interface DirectoryEntry {
  name: string;
  size: number;
  flags: number;
  mtime: number;
}
