/**
 * Request utilities for extracting fields from binary buffers and sending requests.
 */

import type { Frame } from "../transport/framer.ts";
import type { Multiplexer } from "../transport/multiplexer.ts";

/** Extract the 16-byte request body from offset 4-20. */
export function extractBody(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.subarray(4, 20));
}

/** Extract extra data from offset 24+ based on dlen at offset 20. */
export function extractExtraData(buf: Buffer): Uint8Array | undefined {
  const dlen = buf.readUInt32BE(20);
  if (dlen === 0) return undefined;
  return new Uint8Array(buf.subarray(24, 24 + dlen));
}

/** Extract the request ID (uint16 BE) at offset 2. */
export function extractRequestId(buf: Buffer): number {
  return buf.readUInt16BE(2);
}

/** Extract the data length (uint32 BE) at offset 20. */
export function extractDataLength(buf: Buffer): number {
  return buf.readUInt32BE(20);
}

/**
 * Send a request through the multiplexer, extracting fields from the buffer.
 * This is a convenience wrapper used by File and FileSystem classes.
 */
export async function sendRequest(
  mux: Multiplexer,
  buf: Buffer,
  data?: Uint8Array,
): Promise<Frame> {
  const requestId = extractRequestId(buf);
  const body = extractBody(buf);
  const dlen = extractDataLength(buf);
  const extraData = data ??
    (dlen > 0 ? new Uint8Array(buf.subarray(24, 24 + dlen)) : undefined);
  return mux.request(requestId, body, extraData);
}
