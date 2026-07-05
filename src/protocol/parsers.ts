/**
 * Response parsers for XRootD protocol messages.
 * Each function parses a response body Buffer into a typed object.
 */

import { get16, get32, getBytes, getString } from "./codec.ts";
import type { DirectoryEntry } from "../api/types.ts";

/** Protocol response from kXR_protocol. */
export interface ProtocolResponse {
  pval: number;
  flags: number;
  /** Security level from secReqs struct (0=none, 1=compat, 2=std, 3=intense, 4=pedantic). */
  seclvl?: number;
  /** Security options from secReqs struct. */
  secopt?: number;
  /** Bind preferences from bifReqs struct (comma-separated protocol list). */
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
  cpsize: number;
  cptype: string;
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
 * Body layout (binary):
 *   pval[4] + flags[4] +
 *   [optional bifReqs struct: tag[1]='B' + rsvd[1] + bifILen[2] + bifInfo[bifILen]] +
 *   [optional secReqs struct: tag[1]='S' + rsvd[1] + secver[1] + secopt[1] +
 *                             seclvl[1] + secvsz[1] + secvec[secvsz*2]]
 */
export function parseProtocolResponse(body: Buffer): ProtocolResponse {
  let off = 0;
  const [pval, o1] = get32(body, off);
  off = o1;
  const [flags, o2] = get32(body, off);
  off = o2;

  let seclvl: number | undefined;
  let secopt: number | undefined;
  let bifReqs: string | undefined;

  // Parse optional structs identified by tag byte
  while (off < body.length) {
    const tag = body[off];

    if (tag === 0x42 /* 'B' */ && off + 4 <= body.length) {
      // bifReqs struct: tag[1] + rsvd[1] + bifILen[2] + bifInfo[bifILen]
      const [bifILen, lenOff] = get16(body, off + 2);
      off = lenOff;
      if (bifILen > 0 && off + bifILen <= body.length) {
        const raw = body.toString("utf8", off, off + bifILen).replace(/\0+$/, "");
        if (raw) bifReqs = raw;
        off += bifILen;
      } else {
        break;
      }
    } else if (tag === 0x53 /* 'S' */ && off + 6 <= body.length) {
      // secReqs struct: tag[1] + rsvd[1] + secver[1] + secopt[1] + seclvl[1] + secvsz[1]
      secopt = body[off + 3];
      seclvl = body[off + 4];
      const secvsz = body[off + 5];
      off += 6 + secvsz * 2; // skip secvec entries (2 bytes each)
    } else {
      break;
    }
  }

  return { pval, flags, seclvl, secopt, bifReqs };
}

/**
 * Parse secToken from kXR_login response to extract auth protocol names.
 *
 * Format: NUL-terminated string with &P=<name>[,<args>] entries.
 * Example: "&P=host&P=gsi,v:42,c:ssl" → ["host", "gsi"]
 */
export function parseSecToken(token: Uint8Array): string[] {
  const str = Buffer.from(token).toString("utf8");
  const protocols: string[] = [];
  const re = /&P=([a-zA-Z0-9_+-]+)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    protocols.push(match[1]);
  }
  return protocols;
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
  let cpsize = 0;
  let cptype = "";
  if (body.length >= 8) {
    const [v] = get32(body, 4);
    cpsize = v;
  }
  if (body.length >= 12) {
    const [raw] = getBytes(body, 8, 4);
    cptype = Buffer.from(raw).toString("utf8").replace(/\0+$/, "");
  }
  return { fhandle: new Uint8Array(fhandle), cpsize, cptype };
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

const DSTAT_PREFIX = ".\n0 0 0 0";

/**
 * Parse kXR_dirlist response body.
 *
 * Two possible formats depending on options:
 * 1. Names-only (kXR_online, default): `name1\nname2\nname3\0` — newline-separated, last entry null-terminated
 * 2. With stat info (kXR_dstat): `.\n0 0 0 0\nname1\n<statinfo1>\nname2\n<statinfo2>\n...\0`
 *    statinfo format: `<devid> <size> <flags> <mtime> <ctime> <atime> <mode> <owner> <group>`
 */
export function parseDirlistResponse(body: Buffer): DirlistResponse {
  const entries: DirectoryEntry[] = [];

  if (body.length === 0) return { entries };

  const text = body.toString("utf8").replace(/\0$/, "");

  // Detect dstat format by prefix
  if (text.startsWith(DSTAT_PREFIX)) {
    // dstat format: ".\n0 0 0 0\nname1\nstatinfo1\nname2\nstatinfo2\n..."
    const content = text.slice(DSTAT_PREFIX.length + 1); // skip prefix + \n
    const lines = content.split("\n").filter((l) => l.length > 0);

    // Lines come in pairs: name, statinfo
    for (let i = 0; i < lines.length - 1; i += 2) {
      const name = lines[i];
      const statFields = lines[i + 1]?.split(/\s+/);
      if (statFields && statFields.length >= 4) {
        entries.push({
          name,
          size: parseInt(statFields[1], 10) || 0,
          flags: parseInt(statFields[2], 10) || 0,
          mtime: parseInt(statFields[3], 10) || 0,
        });
      }
    }
  } else {
    // Normal format: newline-separated, last entry null-terminated
    const names = text.split("\n");
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        entries.push({
          name: trimmed,
          size: 0,
          flags: 0,
          mtime: 0,
        });
      }
    }
  }

  return { entries };
}
