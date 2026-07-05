/**
 * Frame reader that queues frames from a transport.
 * Used during handshake to avoid race conditions with the Multiplexer.
 */

import type { ITransport } from "../transport/interface.ts";
import type { Frame } from "../transport/framer.ts";
import { Framer } from "../transport/framer.ts";

export interface FrameReader {
  /** Get the next frame, waiting if necessary. */
  nextFrame(): Promise<Frame>;
  /** Remove the data handler from the transport. */
  close(): void;
}

/**
 * Creates a persistent frame reader that registers ONE onData handler
 * before any data is sent, avoiding the race condition where the
 * Multiplexer's handler consumes frames before the handshake can read them.
 *
 * Uses a queue pattern: incoming frames are queued, and nextFrame()
 * resolves the next available frame (or waits for one to arrive).
 */
export function createFrameReader(transport: ITransport): FrameReader {
  const framer = new Framer();
  const frameQueue: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];

  const handler = (chunk: Buffer) => {
    const frames = framer.feed(chunk);
    for (const frame of frames) {
      if (waiters.length > 0) {
        waiters.shift()!(frame);
      } else {
        frameQueue.push(frame);
      }
    }
  };

  transport.onData(handler);

  return {
    nextFrame(): Promise<Frame> {
      if (frameQueue.length > 0) {
        return Promise.resolve(frameQueue.shift()!);
      }
      return new Promise<Frame>((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      transport.removeDataHandler(handler);
    },
  };
}
