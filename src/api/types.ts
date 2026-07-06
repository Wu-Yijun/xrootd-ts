import type { OpenFlags } from "../protocol/constants.ts";
import { S_IFDIR, S_IFLNK } from "../protocol/constants.ts";

// ── Stat Response Flags (kXR_stat body flags field) ────────────────────────
export const StatFlags = {
  XBitSet: 1,
  IsDir: 2,
  Other: 4,
  Offline: 8,
  Readable: 16,
  Writable: 32,
  POSCPending: 64,
  BackUpExists: 128,
  CacheResp: 512,
} as const;
export type StatFlags = typeof StatFlags[keyof typeof StatFlags];

export interface OpenOptions {
  flags?: OpenFlags;
  mode?: number;
  signal?: AbortSignal;
}

export interface StatInfo {
  id: string;
  size: bigint;
  flags: number;
  mtime: number;
  ctime: number;
  atime: number;
  mode: number;
  owner: string;
  group: string;
  get isDirectory(): boolean;
  get isLink(): boolean;
  get isOffline(): boolean;
  get isCached(): boolean;
}

/**
 * Parse XRootD stat response string.
 *
 * Format: "<id> <size> <flags> <mtime> <ctime> <atime> <mode> <owner> <group>"
 *   - id:     opaque 64-bit device id (string to avoid precision loss)
 *   - size:   uint64 file size (bigint)
 *   - flags:  XRootD flags bitmask (StatFlags)
 *   - mtime:  modification time (epoch seconds)
 *   - ctime:  change time (epoch seconds)
 *   - atime:  access time (epoch seconds)
 *   - mode:   POSIX mode (octal string, e.g. "100644")
 *   - owner:  file owner
 *   - group:  file group
 */
export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().replace(/\0+$/, "").split(/\s+/);
  const id = parts[0] ?? "0";
  const size = BigInt(parts[1] ?? "0");
  const serverFlags = parseInt(parts[2] ?? "0", 10) || 0;
  const mtime = parseInt(parts[3] ?? "0", 10) || 0;
  const ctime = parseInt(parts[4] ?? "0", 10) || 0;
  const atime = parseInt(parts[5] ?? "0", 10) || 0;
  const modeStr = parts[6] ?? "0";
  const mode = parseInt(modeStr, 8) || 0;
  const owner = parts[7] ?? "";
  const group = parts[8] ?? "";

  return {
    id,
    size,
    flags: serverFlags,
    mtime,
    ctime,
    atime,
    mode,
    owner,
    group,
    get isDirectory() {
      return (serverFlags & StatFlags.IsDir) !== 0;
    },
    get isLink() {
      return (mode & S_IFLNK) === S_IFLNK;
    },
    get isOffline() {
      return (serverFlags & StatFlags.Offline) !== 0;
    },
    get isCached() {
      return (serverFlags & StatFlags.CacheResp) !== 0;
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
  /** Extended fields populated when dstat option is used */
  ctime?: number;
  atime?: number;
  mode?: number;
  owner?: string;
  group?: string;
}
