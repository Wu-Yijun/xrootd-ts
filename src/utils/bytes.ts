/**
 * Byte conversion utilities for the XRootD protocol.
 */

/** Convert a stream ID (uint16) to a 2-byte big-endian Uint8Array. */
export function streamIdToBytes(sid: number): Uint8Array {
  return new Uint8Array([(sid >> 8) & 0xff, sid & 0xff]);
}

/** Convert a string to UTF-8 bytes. */
export function strToBytes(str: string): Uint8Array {
  return Buffer.from(str, "utf8");
}

/** Parse a stream ID from 2 big-endian bytes. */
export function bytesToStreamId(bytes: Uint8Array): number {
  return (bytes[0] << 8) | bytes[1];
}
