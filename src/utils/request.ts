/**
 * Request utilities for extracting fields from binary buffers and sending requests.
 */

import type { Frame } from "../transport/framer.ts";
import type { Multiplexer } from "../transport/multiplexer.ts";
import {
  REQUEST_OFFSET_BODY,
  REQUEST_OFFSET_DLEN,
  REQUEST_OFFSET_REQUEST_ID,
} from "../protocol/constants.ts";

/** Extract the 16-byte request body. */
export function extractBody(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.subarray(REQUEST_OFFSET_BODY, REQUEST_OFFSET_BODY + 16));
}

/** Extract extra data based on dlen. */
export function extractExtraData(buf: Buffer): Uint8Array | undefined {
  const dlen = extractDataLength(buf);
  if (dlen === 0) return undefined;
  return new Uint8Array(buf.subarray(REQUEST_OFFSET_DLEN + 4, REQUEST_OFFSET_DLEN + 4 + dlen));
}

/** Extract the request ID (uint16 BE). */
export function extractRequestId(buf: Buffer): number {
  return buf.readUInt16BE(REQUEST_OFFSET_REQUEST_ID);
}

/** Extract the data length (uint32 BE). */
export function extractDataLength(buf: Buffer): number {
  return buf.readUInt32BE(REQUEST_OFFSET_DLEN);
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
    (dlen > 0 ? new Uint8Array(buf.subarray(REQUEST_OFFSET_DLEN + 4, REQUEST_OFFSET_DLEN + 4 + dlen)) : undefined);
  return mux.request(requestId, body, extraData);
}
