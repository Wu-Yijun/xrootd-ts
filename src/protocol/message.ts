import {
  PROTOCOL_VERSION,
  HANDSHAKE_FIRST,
  HANDSHAKE_SECOND,
  HANDSHAKE_THIRD,
  HANDSHAKE_FOURTH,
  HANDSHAKE_FIFTH,
  REQUEST_HDR_SIZE,
} from './constants.ts';
import {
  put16,
  put32,
  putString,
  putBytes,
  get32,
  getString,
  getBytes,
} from './codec.ts';

// ── Response interfaces ────────────────────────────────────────────────────

export interface ProtocolResponse {
  pval: number;
  flags: number;
  secReqs?: string;
  bifReqs?: string;
}

export interface LoginResponse {
  sessid: Uint8Array;
  secToken?: Uint8Array;
  needsAuth: boolean;
}

export interface OpenResponse {
  fhandle: Uint8Array;
}

export interface ErrorResponse {
  errnum: number;
  errmsg: string;
}

export interface RedirectResponse {
  port: number;
  host: string;
}

export interface WaitResponse {
  seconds: number;
  infomsg: string;
}

// ── Message class ──────────────────────────────────────────────────────────

export class Message {
  private buffer: Buffer;
  private offset = 0;

  constructor(size: number) {
    this.buffer = Buffer.alloc(size);
  }

  writeInt32BE(value: number): void {
    this.buffer.writeInt32BE(value, this.offset);
    this.offset += 4;
  }

  writeInt16BE(value: number): void {
    this.buffer.writeInt16BE(value, this.offset);
    this.offset += 2;
  }

  writeUInt8(value: number): void {
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
  }

  writeBytes(data: Uint8Array): void {
    Buffer.from(data).copy(this.buffer, this.offset);
    this.offset += data.length;
  }

  readInt32BE(): number {
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readInt16BE(): number {
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readBytes(length: number): Buffer {
    const data = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function streamIdToBytes(sid: number): Uint8Array {
  return new Uint8Array([(sid >> 8) & 0xff, sid & 0xff]);
}

function strToBytes(str: string): Uint8Array {
  return Buffer.from(str, 'utf8');
}

// ── Request Builders ───────────────────────────────────────────────────────

/**
 * Initial handshake (20 B) + kXR_protocol (24 B) merged into one 44-byte
 * buffer ready to send immediately after TCP connect.
 *
 * Layout:
 *   [0..19]  ClientInitHandShake
 *   [20..43] kXR_protocol request (streamid=0, body, dlen)
 */
export function buildHandshakeAndProtocol(
  streamId: number,
  flags: number = 0x01, // kXR_secreqs
  expect: number = 0x01, // kXR_ExpLogin
): Buffer {
  const msg = new Message(20 + REQUEST_HDR_SIZE);

  // ── ClientInitHandShake (20 B) ──
  msg.writeInt32BE(HANDSHAKE_FIRST);
  msg.writeInt32BE(HANDSHAKE_SECOND);
  msg.writeInt32BE(HANDSHAKE_THIRD);
  msg.writeInt32BE(HANDSHAKE_FOURTH);
  msg.writeInt32BE(HANDSHAKE_FIFTH);

  // ── kXR_protocol request (24 B) ──
  // streamid
  msg.writeBytes(streamIdToBytes(streamId));
  // requestid
  msg.writeInt16BE(3006); // RequestId.Protocol
  // body.clientpv (4 B)
  msg.writeInt32BE(PROTOCOL_VERSION);
  // body.flags (1 B)
  msg.writeUInt8(flags & 0xff);
  // body.expect (1 B)
  msg.writeUInt8(expect & 0xff);
  // body.reserved (10 B) — zero-filled by Buffer.alloc
  msg.writeBytes(new Uint8Array(10));
  // dlen (4 B)
  msg.writeInt32BE(0);

  return msg.getBuffer();
}

/**
 * kXR_login request (24 B header only, or 24 B + CGI string).
 *
 * Body layout (16 B):
 *   pid[4] + username[8] + ability2[1] + ability[1] + capver[1] + reserved[1]
 */
export function buildLoginRequest(
  streamId: number,
  pid: number,
  username: string,
  ability: number = 0,
  cgi?: string,
): Buffer {
  const cgiBytes = cgi ? strToBytes(cgi) : undefined;
  const msg = new Message(REQUEST_HDR_SIZE + (cgiBytes?.length ?? 0));

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3007); // RequestId.Login

  // body
  msg.writeInt32BE(pid);
  const u8 = strToBytes(username);
  msg.writeBytes(u8.length > 8 ? u8.subarray(0, 8) : u8);
  // pad username to 8 bytes
  if (u8.length < 8) {
    msg.writeBytes(new Uint8Array(8 - u8.length));
  }
  msg.writeUInt8(0); // ability2
  msg.writeUInt8(ability & 0xff);
  msg.writeUInt8(0x04); // capver (v4)
  msg.writeUInt8(0); // reserved

  // dlen
  msg.writeInt32BE(cgiBytes?.length ?? 0);

  // extra data
  if (cgiBytes && cgiBytes.length > 0) {
    msg.writeBytes(cgiBytes);
  }

  return msg.getBuffer();
}

/**
 * kXR_open request (24 B header + path string).
 *
 * Body layout (16 B):
 *   mode[2] + options[2] + optiont[2] + reserved[6] + fhtemplt[4]
 */
export function buildOpenRequest(
  streamId: number,
  path: string,
  options: number,
  mode: number = 0,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3010); // RequestId.Open

  // body
  msg.writeInt16BE(mode & 0xffff);
  msg.writeInt16BE(options & 0xffff);
  msg.writeInt16BE(0); // optiont
  msg.writeBytes(new Uint8Array(6)); // reserved
  msg.writeBytes(new Uint8Array(4)); // fhtemplt

  // dlen
  msg.writeInt32BE(pathBytes.length);

  // path
  msg.writeBytes(pathBytes);

  return msg.getBuffer();
}

/**
 * kXR_read request (24 B header, no extra data).
 *
 * Body layout (16 B):
 *   fhandle[4] + offset[8] + rlen[4]
 */
export function buildReadRequest(
  streamId: number,
  fhandle: Uint8Array,
  offset: number,
  rlen: number,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3013); // RequestId.Read

  // body
  msg.writeBytes(fhandle);
  // offset as int64 BE — write high 32 bits then low 32 bits
  msg.writeInt32BE(Math.floor(offset / 0x100000000));
  msg.writeInt32BE(offset >>> 0);
  msg.writeInt32BE(rlen);

  // dlen
  msg.writeInt32BE(0);

  return msg.getBuffer();
}

/**
 * kXR_write request (24 B header + data bytes).
 *
 * Body layout (16 B):
 *   fhandle[4] + offset[8] + pathid[1] + reserved[3]
 */
export function buildWriteRequest(
  streamId: number,
  fhandle: Uint8Array,
  offset: number,
  data: Uint8Array,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE + data.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3019); // RequestId.Write

  // body
  msg.writeBytes(fhandle);
  msg.writeInt32BE(Math.floor(offset / 0x100000000));
  msg.writeInt32BE(offset >>> 0);
  msg.writeUInt8(0); // pathid
  msg.writeBytes(new Uint8Array(3)); // reserved

  // dlen
  msg.writeInt32BE(data.length);

  // data
  msg.writeBytes(data);

  return msg.getBuffer();
}

/**
 * kXR_close request (24 B header, no extra data).
 *
 * Body layout (16 B):
 *   fhandle[4] + reserved[12]
 */
export function buildCloseRequest(
  streamId: number,
  fhandle: Uint8Array,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3003); // RequestId.Close

  // body
  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12)); // reserved

  // dlen
  msg.writeInt32BE(0);

  return msg.getBuffer();
}

/**
 * kXR_stat request (24 B header + optional path string).
 *
 * Body layout (16 B):
 *   options[1] + reserved[7] + wants[4] + fhandle[4]
 */
export function buildStatRequest(
  streamId: number,
  path: string,
  fhandle?: Uint8Array,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3017); // RequestId.Stat

  // body
  if (fhandle) {
    // stat by file handle — options = 0, fhandle filled, dlen = 0
    msg.writeUInt8(0); // options
    msg.writeBytes(new Uint8Array(7)); // reserved
    msg.writeBytes(new Uint8Array(4)); // wants
    msg.writeBytes(fhandle);
    msg.writeInt32BE(0); // dlen
  } else {
    // stat by path — options = 0, wants = 0, fhandle zeroed
    msg.writeUInt8(0); // options
    msg.writeBytes(new Uint8Array(7)); // reserved
    msg.writeBytes(new Uint8Array(4)); // wants
    msg.writeBytes(new Uint8Array(4)); // fhandle
    msg.writeInt32BE(pathBytes.length); // dlen
    msg.writeBytes(pathBytes);
  }

  return msg.getBuffer();
}

// ── Response Parsers ───────────────────────────────────────────────────────

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

// ── Phase 2 Request Builders ───────────────────────────────────────────────

/**
 * kXR_sync request (24 B header, no extra data).
 *
 * Body layout (16 B):
 *   fhandle[4] + reserved[12]
 */
export function buildSyncRequest(
  streamId: number,
  fhandle: Uint8Array,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3016); // RequestId.Sync

  // body
  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12)); // reserved

  // dlen
  msg.writeInt32BE(0);

  return msg.getBuffer();
}

/**
 * kXR_truncate request (24 B header + 8 B size).
 *
 * Body layout (16 B):
 *   fhandle[4] + reserved[12]
 * Extra data:
 *   size[8] (int64 BE)
 */
export function buildTruncateRequest(
  streamId: number,
  fhandle: Uint8Array,
  size: number,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE + 8);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3028); // RequestId.Truncate

  // body
  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12)); // reserved

  // dlen
  msg.writeInt32BE(8);

  // size as int64 BE
  msg.writeInt32BE(Math.floor(size / 0x100000000));
  msg.writeInt32BE(size >>> 0);

  return msg.getBuffer();
}

/**
 * kXR_dirlist request (24 B header + path string).
 *
 * Body layout (16 B):
 *   reserved[15] + options[1]
 */
export function buildDirlistRequest(
  streamId: number,
  path: string,
  options: number = 0,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3004); // RequestId.Dirlist

  // body
  msg.writeBytes(new Uint8Array(15)); // reserved
  msg.writeUInt8(options & 0xff);

  // dlen
  msg.writeInt32BE(pathBytes.length);

  // path
  msg.writeBytes(pathBytes);

  return msg.getBuffer();
}

/**
 * kXR_mkdir request (24 B header + path string).
 *
 * Body layout (16 B):
 *   mode[2] + reserved[14]
 */
export function buildMkdirRequest(
  streamId: number,
  path: string,
  mode: number = 0o755,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3008); // RequestId.Mkdir

  // body
  msg.writeInt16BE(mode & 0xffff);
  msg.writeBytes(new Uint8Array(14)); // reserved

  // dlen
  msg.writeInt32BE(pathBytes.length);

  // path
  msg.writeBytes(pathBytes);

  return msg.getBuffer();
}

/**
 * kXR_rmdir request (24 B header + path string).
 *
 * Body layout (16 B):
 *   reserved[16]
 */
export function buildRmdirRequest(
  streamId: number,
  path: string,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3015); // RequestId.Rmdir

  // body
  msg.writeBytes(new Uint8Array(16)); // reserved

  // dlen
  msg.writeInt32BE(pathBytes.length);

  // path
  msg.writeBytes(pathBytes);

  return msg.getBuffer();
}

/**
 * kXR_rm request (24 B header + path string).
 *
 * Body layout (16 B):
 *   reserved[16]
 */
export function buildRmRequest(
  streamId: number,
  path: string,
): Buffer {
  const pathBytes = strToBytes(path);
  const msg = new Message(REQUEST_HDR_SIZE + pathBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3014); // RequestId.Rm

  // body
  msg.writeBytes(new Uint8Array(16)); // reserved

  // dlen
  msg.writeInt32BE(pathBytes.length);

  // path
  msg.writeBytes(pathBytes);

  return msg.getBuffer();
}

/**
 * kXR_mv request (24 B header + source + target).
 *
 * Body layout (16 B):
 *   reserved[14] + arg1len[2]
 * Extra data:
 *   source[arg1len] + target[dlen - arg1len]
 */
export function buildMvRequest(
  streamId: number,
  source: string,
  target: string,
): Buffer {
  const srcBytes = strToBytes(source);
  const tgtBytes = strToBytes(target);
  const msg = new Message(REQUEST_HDR_SIZE + srcBytes.length + tgtBytes.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3009); // RequestId.Mv

  // body
  msg.writeBytes(new Uint8Array(14)); // reserved
  msg.writeInt16BE(srcBytes.length & 0xffff); // arg1len

  // dlen
  msg.writeInt32BE(srcBytes.length + tgtBytes.length);

  // source + target
  msg.writeBytes(srcBytes);
  msg.writeBytes(tgtBytes);

  return msg.getBuffer();
}

/**
 * kXR_auth request (24 B header + credential data).
 *
 * Body layout (16 B):
 *   reserved[12] + credtype[4]
 */
export function buildAuthRequest(
  streamId: number,
  credType: number,
  credData: Uint8Array,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE + credData.length);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3000); // RequestId.Auth

  // body
  msg.writeBytes(new Uint8Array(12)); // reserved
  msg.writeInt32BE(credType);

  // dlen
  msg.writeInt32BE(credData.length);

  // credential data
  msg.writeBytes(credData);

  return msg.getBuffer();
}

/**
 * kXR_endsess request (24 B header, no extra data).
 *
 * Body layout (16 B):
 *   sessid[16]
 */
export function buildEndsessRequest(
  streamId: number,
  sessid: Uint8Array,
): Buffer {
  const msg = new Message(REQUEST_HDR_SIZE);

  // header
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(3023); // RequestId.Endsess

  // body
  msg.writeBytes(sessid);

  // dlen
  msg.writeInt32BE(0);

  return msg.getBuffer();
}

// ── Phase 2 Response Parsers ───────────────────────────────────────────────

export interface DirectoryEntry {
  name: string;
  size: number;
  flags: number;
  mtime: number;
}

export interface DirlistResponse {
  entries: DirectoryEntry[];
}

/**
 * Parse kXR_dirlist response body.
 *
 * Each entry format: `name\0size:flags:mtime\n`
 * Entries are separated by newlines; name and metadata separated by NUL.
 */
export function parseDirlistResponse(body: Buffer): DirlistResponse {
  const text = body.toString('utf8');
  const entries: DirectoryEntry[] = [];

  // Split by newline, filter empty lines
  const lines = text.split('\n').filter((l) => l.length > 0);

  for (const line of lines) {
    // Each line: "name\0size:flags:mtime"
    const nulIdx = line.indexOf(String.fromCharCode(0));
    if (nulIdx === -1) continue;

    const name = line.substring(0, nulIdx);
    const rest = line.substring(nulIdx + 1);
    const fields = rest.split(':');

    if (fields.length >= 3) {
      entries.push({
        name,
        size: parseInt(fields[0], 10) || 0,
        flags: parseInt(fields[1], 10) || 0,
        modTime: parseInt(fields[2], 10) || 0,
      });
    }
  }

  return { entries };
}
