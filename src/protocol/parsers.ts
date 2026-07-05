/**
 * Response parsers for XRootD protocol messages.
 * Each function parses a response body Buffer into a typed object.
 */

import { get32, getBytes, getString } from "./codec.ts";
import type { DirectoryEntry } from "../api/types.ts";

/** Protocol response from kXR_protocol. */
export interface ProtocolResponse {
  pval: number;
  flags: number;
  secReqs?: string;
  bifReqs?: string;
}

/** Login response from kXR_login. */
export interface LoginResponse {
  sessid: Uint8Array;
  secToken?: Uint8Array;
  needsAuth: boolean;
}

/** Open response from kXR_open. */
export interface OpenResponse {
  fhandle: Uint8Array;
}

/** Error response from kXR_error. */
export interface ErrorResponse {
  errnum: number;
  errmsg: string;
}

/** Redirect response from kXR_redirect. */
export interface RedirectResponse {
  port: number;
  host: string;
}

/** Wait response from kXR_wait / kXR_waitresp. */
export interface WaitResponse {
  seconds: number;
  infomsg: string;
}

/** Directory listing response from kXR_dirlist. */
export interface DirlistResponse {
  entries: DirectoryEntry[];
}

/**
 * Parse kXR_protocol OK response body.
 *
 * Body layout:
 *   pval[4] + flags[4] + secReqs (remaining bytes, NUL-terminated) +
 *   bifReqs (remaining bytes, NUL-terminated)
 */
export function parseProtocolResponse(body: Buffer): ProtocolResponse {
  let off = 0;
  const [pval, o1] = get32(body, off);
  off = o1;
  const [flags, o2] = get32(body, off);
  off = o2;

  let secReqs: string | undefined;
  let bifReqs: string | undefined;

  if (off < body.length) {
    const [s, o3] = getString(body, off, body.length - off);
    off = o3;
    if (s) secReqs = s;
  }
  if (off < body.length) {
    const [b] = getString(body, off, body.length - off);
    if (b) bifReqs = b;
  }

  return { pval, flags, secReqs, bifReqs };
}

/**
 * Parse kXR_login OK response body.
 *
 * Body layout:
 *   sessid[16] + optional secToken (remaining bytes)
 */
export function parseLoginResponse(body: Buffer): LoginResponse {
  const [sessid] = getBytes(body, 0, 16);
  let secToken: Uint8Array | undefined;

  if (body.length > 16) {
    const [tok] = getBytes(body, 16, body.length - 16);
    secToken = tok;
  }

  return {
    sessid: new Uint8Array(sessid),
    secToken,
    needsAuth: body.length > 16,
  };
}

/**
 * Parse kXR_open OK response body.
 *
 * Body layout:
 *   fhandle[4] + cpsize[4] + cptype[4] + optional stat
 */
export function parseOpenResponse(body: Buffer): OpenResponse {
  const [fhandle] = getBytes(body, 0, 4);
  return { fhandle: new Uint8Array(fhandle) };
}

/**
 * Parse kXR_error response body.
 *
 * Body layout:
 *   errnum[4] + errmsg[variable, NUL-terminated]
 */
export function parseErrorResponse(body: Buffer): ErrorResponse {
  const [errnum, off] = get32(body, 0);
  const [errmsg] = getString(body, off, body.length - off);
  return { errnum, errmsg };
}

/**
 * Parse kXR_redirect response body.
 *
 * Body layout:
 *   port[4] + host[variable, NUL-terminated]
 */
export function parseRedirectResponse(body: Buffer): RedirectResponse {
  const [port, off] = get32(body, 0);
  const [host] = getString(body, off, body.length - off);
  return { port, host };
}

/**
 * Parse kXR_wait / kXR_waitresp response body.
 *
 * Body layout:
 *   seconds[4] + infomsg[variable, NUL-terminated]
 */
export function parseWaitResponse(body: Buffer): WaitResponse {
  const [seconds, off] = get32(body, 0);
  const [infomsg] = getString(body, off, body.length - off);
  return { seconds, infomsg };
}

/**
 * Parse kXR_dirlist response body.
 *
 * Two possible formats depending on options:
 * 1. Names-only (kXR_online, default): `name\0name2\0name3\0` — null-separated
 * 2. With stat info (kXR_dstat): `name\0size:flags:mtime\n` — newline-separated
 */
export function parseDirlistResponse(body: Buffer): DirlistResponse {
  const entries: DirectoryEntry[] = [];

  if (body.length === 0) return { entries };

  const hasMetadata = body.toString("utf8").includes("\0") &&
    body.toString("utf8").includes(":");

  if (hasMetadata) {
    const text = body.toString("utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      const nulIdx = line.indexOf(String.fromCharCode(0));
      if (nulIdx === -1) continue;

      const name = line.substring(0, nulIdx);
      const rest = line.substring(nulIdx + 1);
      const fields = rest.split(":");

      if (fields.length >= 3) {
        entries.push({
          name,
          size: parseInt(fields[0], 10) || 0,
          flags: parseInt(fields[1], 10) || 0,
          mtime: parseInt(fields[2], 10) || 0,
        });
      }
    }
  } else {
    const text = body.toString("utf8");
    const parts = text.split("\0");

    for (const part of parts) {
      const name = part.trim();
      if (name.length > 0) {
        entries.push({
          name,
          size: 0,
          flags: 0,
          mtime: 0,
        });
      }
    }
  }

  return { entries };
}
