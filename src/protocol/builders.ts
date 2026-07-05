/**
 * Request builders for XRootD protocol messages.
 * Each function creates a Buffer ready to send on the wire.
 */

import {
  HANDSHAKE_FIFTH,
  HANDSHAKE_FIRST,
  HANDSHAKE_FOURTH,
  HANDSHAKE_SECOND,
  HANDSHAKE_THIRD,
  kXR_ExpLogin,
  kXR_secreqs,
  PROTOCOL_VERSION,
  REQUEST_HDR_SIZE,
  RequestId,
} from "./constants.ts";
import { Message } from "./message-class.ts";
import { streamIdToBytes, strToBytes } from "../utils/bytes.ts";

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
  flags: number = kXR_secreqs,
  expect: number = kXR_ExpLogin,
): Buffer {
  const msg = new Message(20 + REQUEST_HDR_SIZE);

  // ── ClientInitHandShake (20 B) ──
  msg.writeInt32BE(HANDSHAKE_FIRST);
  msg.writeInt32BE(HANDSHAKE_SECOND);
  msg.writeInt32BE(HANDSHAKE_THIRD);
  msg.writeInt32BE(HANDSHAKE_FOURTH);
  msg.writeInt32BE(HANDSHAKE_FIFTH);

  // ── kXR_protocol request (24 B) ──
  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Protocol);
  msg.writeInt32BE(PROTOCOL_VERSION);
  msg.writeUInt8(flags & 0xff);
  msg.writeUInt8(expect & 0xff);
  msg.writeBytes(new Uint8Array(10));
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Login);

  msg.writeInt32BE(pid);
  const u8 = strToBytes(username);
  msg.writeBytes(u8.length > 8 ? u8.subarray(0, 8) : u8);
  if (u8.length < 8) {
    msg.writeBytes(new Uint8Array(8 - u8.length));
  }
  msg.writeUInt8(0);
  msg.writeUInt8(ability & 0xff);
  msg.writeUInt8(0x04);
  msg.writeUInt8(0);

  msg.writeInt32BE(cgiBytes?.length ?? 0);

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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Open);

  msg.writeInt16BE(mode & 0xffff);
  msg.writeInt16BE(options & 0xffff);
  msg.writeInt16BE(0);
  msg.writeBytes(new Uint8Array(6));
  msg.writeBytes(new Uint8Array(4));

  msg.writeInt32BE(pathBytes.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Read);

  msg.writeBytes(fhandle);
  msg.writeInt32BE(Math.floor(offset / 0x100000000));
  msg.writeInt32BE(offset >>> 0);
  msg.writeInt32BE(rlen);

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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Write);

  msg.writeBytes(fhandle);
  msg.writeInt32BE(Math.floor(offset / 0x100000000));
  msg.writeInt32BE(offset >>> 0);
  msg.writeUInt8(0);
  msg.writeBytes(new Uint8Array(3));

  msg.writeInt32BE(data.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Close);

  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12));

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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Stat);

  if (fhandle) {
    msg.writeUInt8(0);
    msg.writeBytes(new Uint8Array(7));
    msg.writeBytes(new Uint8Array(4));
    msg.writeBytes(fhandle);
    msg.writeInt32BE(0);
  } else {
    msg.writeUInt8(0);
    msg.writeBytes(new Uint8Array(7));
    msg.writeBytes(new Uint8Array(4));
    msg.writeBytes(new Uint8Array(4));
    msg.writeInt32BE(pathBytes.length);
    msg.writeBytes(pathBytes);
  }

  return msg.getBuffer();
}

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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Sync);

  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12));

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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Truncate);

  msg.writeBytes(fhandle);
  msg.writeBytes(new Uint8Array(12));

  msg.writeInt32BE(8);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Dirlist);

  msg.writeBytes(new Uint8Array(15));
  msg.writeUInt8(options & 0xff);

  msg.writeInt32BE(pathBytes.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Mkdir);

  msg.writeInt16BE(mode & 0xffff);
  msg.writeBytes(new Uint8Array(14));

  msg.writeInt32BE(pathBytes.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Rmdir);

  msg.writeBytes(new Uint8Array(16));

  msg.writeInt32BE(pathBytes.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Rm);

  msg.writeBytes(new Uint8Array(16));

  msg.writeInt32BE(pathBytes.length);
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
  const spaceSep = new Uint8Array([0x20]); // SPACE separator
  const msg = new Message(
    REQUEST_HDR_SIZE + srcBytes.length + 1 + tgtBytes.length,
  );

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Mv);

  msg.writeBytes(new Uint8Array(14));
  msg.writeInt16BE(srcBytes.length & 0xffff);

  msg.writeInt32BE(srcBytes.length + 1 + tgtBytes.length);

  msg.writeBytes(srcBytes);
  msg.writeBytes(spaceSep);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Auth);

  msg.writeBytes(new Uint8Array(12));
  msg.writeInt32BE(credType);

  msg.writeInt32BE(credData.length);
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

  msg.writeBytes(streamIdToBytes(streamId));
  msg.writeInt16BE(RequestId.Endsess);

  msg.writeBytes(sessid);

  msg.writeInt32BE(0);

  return msg.getBuffer();
}
