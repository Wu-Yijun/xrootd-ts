import { RESPONSE_HDR_SIZE } from "../protocol/constants.ts";

/** Complete XRootD response frame */
export interface Frame {
  streamId: Buffer;
  status: number;
  dlen: number;
  body: Buffer;
}

/**
 * Frame parser: handles TCP fragmentation, splits byte stream into complete XRootD response frames.
 *
 * XRootD response format:
 *   streamid[2] + status[2] + dlen[4] + body[dlen]
 *   Fixed header 8 bytes + variable body
 */
export class Framer {
  private pending = Buffer.alloc(0);

  /** Feed raw bytes, return parsed complete frames (0 or more) */
  feed(chunk: Buffer): Frame[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Frame[] = [];

    while (this.pending.length >= RESPONSE_HDR_SIZE) {
      const dlen = this.pending.readUInt32BE(4);
      if (this.pending.length < RESPONSE_HDR_SIZE + dlen) break;

      frames.push({
        streamId: this.pending.subarray(0, 2),
        status: this.pending.readUInt16BE(2),
        dlen,
        body: this.pending.subarray(
          RESPONSE_HDR_SIZE,
          RESPONSE_HDR_SIZE + dlen,
        ),
      });
      this.pending = this.pending.subarray(RESPONSE_HDR_SIZE + dlen);
    }

    return frames;
  }
}
