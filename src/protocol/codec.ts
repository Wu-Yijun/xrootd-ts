/**
 * Big-endian encoding / decoding utilities for the XRootD protocol.
 *
 * Every multi-byte field in XRootD is transmitted in network byte order
 * (big-endian).  The helpers below keep offset tracking explicit so
 * callers never forget to advance.
 */

// ── uint16 ─────────────────────────────────────────────────────────────────

/** Write `value` as uint16 BE at `offset`, return new offset. */
export function put16(buf: Buffer, offset: number, value: number): number {
  buf.writeUInt16BE(value, offset);
  return offset + 2;
}

/** Read uint16 BE at `offset`, return `[value, newOffset]`. */
export function get16(buf: Buffer, offset: number): [number, number] {
  return [buf.readUInt16BE(offset), offset + 2];
}

// ── uint32 ─────────────────────────────────────────────────────────────────

/** Write `value` as uint32 BE at `offset`, return new offset. */
export function put32(buf: Buffer, offset: number, value: number): number {
  buf.writeUInt32BE(value, offset);
  return offset + 4;
}

/** Read uint32 BE at `offset`, return `[value, newOffset]`. */
export function get32(buf: Buffer, offset: number): [number, number] {
  return [buf.readUInt32BE(offset), offset + 4];
}

// ── Strings ────────────────────────────────────────────────────────────────

/**
 * Write `str` bytes into `buf` starting at `offset`, padded with zeros
 * up to `maxLen`.  Returns the new offset (always `offset + maxLen`).
 */
export function putString(
  buf: Buffer,
  offset: number,
  str: string,
  maxLen: number,
): number {
  const bytes = Buffer.from(str, "utf8");
  const len = Math.min(bytes.length, maxLen);
  bytes.copy(buf, offset, 0, len);
  // zero-fill remainder
  buf.fill(0, offset + len, offset + maxLen);
  return offset + maxLen;
}

/**
 * Read a fixed-length string from `buf` at `offset` for `length` bytes.
 * Trailing NUL bytes are stripped.
 */
export function getString(
  buf: Buffer,
  offset: number,
  length: number,
): [string, number] {
  const str = buf.toString("utf8", offset, offset + length).replace(/\0+$/, "");
  return [str, offset + length];
}

// ── Raw bytes ──────────────────────────────────────────────────────────────

/** Copy `data` into `buf` at `offset`, return new offset. */
export function putBytes(
  buf: Buffer,
  offset: number,
  data: Uint8Array,
): number {
  Buffer.from(data).copy(buf, offset);
  return offset + data.length;
}

/** Slice `length` bytes from `buf` at `offset`, return `[slice, newOffset]`. */
export function getBytes(
  buf: Buffer,
  offset: number,
  length: number,
): [Buffer, number] {
  return [buf.subarray(offset, offset + length), offset + length];
}
