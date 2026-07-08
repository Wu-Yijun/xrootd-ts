import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Framer } from "./framer.ts";

function makeFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8);
  hdr.writeUInt16BE(streamId, 0);
  hdr.writeUInt16BE(status, 2);
  hdr.writeUInt32BE(body.length, 4);
  return Buffer.concat([hdr, body]);
}

describe("Framer", () => {
  it("parses a complete frame in one chunk", () => {
    const framer = new Framer();
    const body = Buffer.from([1, 2, 3, 4]);
    const frame = makeFrame(0x0102, 0, body);

    const frames = framer.feed(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].status, 0);
    assert.equal(frames[0].dlen, 4);
    assert.deepEqual([...frames[0].body], [1, 2, 3, 4]);
  });

  it("parses 1-byte-at-a-time feed", () => {
    const framer = new Framer();
    const body = Buffer.from([0xaa, 0xbb, 0xcc]);
    const frame = makeFrame(1, 0, body);

    let allFrames: ReturnType<Framer["feed"]> = [];
    for (let i = 0; i < frame.length; i++) {
      allFrames = allFrames.concat(framer.feed(frame.subarray(i, i + 1)));
    }

    assert.equal(allFrames.length, 1);
    assert.equal(allFrames[0].dlen, 3);
  });

  it("parses random-length chunks", () => {
    const framer = new Framer();
    const body = Buffer.alloc(50).fill(0xff);
    const frame = makeFrame(42, 0, body);

    let offset = 0;
    let allFrames: ReturnType<Framer["feed"]> = [];
    while (offset < frame.length) {
      const len = Math.min(
        Math.ceil(Math.random() * 10),
        frame.length - offset,
      );
      allFrames = allFrames.concat(
        framer.feed(frame.subarray(offset, offset + len)),
      );
      offset += len;
    }

    assert.equal(allFrames.length, 1);
    assert.equal(allFrames[0].status, 0);
    assert.equal(allFrames[0].dlen, 50);
  });

  it("returns empty on incomplete header (< 8 bytes)", () => {
    const framer = new Framer();
    const partial = Buffer.from([0, 0, 0, 0]);
    const frames = framer.feed(partial);
    assert.equal(frames.length, 0);
  });

  it("returns empty when header ok but body pending", () => {
    const framer = new Framer();
    const body = Buffer.alloc(100).fill(0xab);
    const frame = makeFrame(1, 0, body);

    // feed only first 8 bytes (header) + 10 bytes of body
    const partial = frame.subarray(0, 18);
    const frames = framer.feed(partial);
    assert.equal(frames.length, 0);

    // feed remaining body
    const rest = frame.subarray(18);
    const frames2 = framer.feed(rest);
    assert.equal(frames2.length, 1);
    assert.equal(frames2[0].dlen, 100);
  });

  it("parses multiple frames concatenated in one chunk", () => {
    const framer = new Framer();
    const body1 = Buffer.from([1]);
    const body2 = Buffer.from([2, 3]);
    const frame1 = makeFrame(10, 0, body1);
    const frame2 = makeFrame(20, 4003, body2);

    const combined = Buffer.concat([frame1, frame2]);
    const frames = framer.feed(combined);

    assert.equal(frames.length, 2);
    assert.equal(frames[0].status, 0);
    assert.equal(frames[0].dlen, 1);
    assert.equal(frames[1].status, 4003);
    assert.equal(frames[1].dlen, 2);
  });

  it("handles empty data feed", () => {
    const framer = new Framer();
    const frames = framer.feed(Buffer.alloc(0));
    assert.equal(frames.length, 0);
  });

  it("handles multiple feeds building up a frame", () => {
    const framer = new Framer();
    const body = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const frame = makeFrame(99, 0, body);

    // split into 3 arbitrary chunks
    const c1 = frame.subarray(0, 5);
    const c2 = frame.subarray(5, 10);
    const c3 = frame.subarray(10);

    const f1 = framer.feed(c1);
    assert.equal(f1.length, 0);
    const f2 = framer.feed(c2);
    assert.equal(f2.length, 0);
    const f3 = framer.feed(c3);
    assert.equal(f3.length, 1);
    assert.deepEqual([...f3[0].body], [0xde, 0xad, 0xbe, 0xef]);
  });

  it("parses body=0 frame correctly", () => {
    const framer = new Framer();
    const frame = makeFrame(0, 0, Buffer.alloc(0));
    const frames = framer.feed(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].dlen, 0);
    assert.equal(frames[0].body.length, 0);
  });

  it("parses 3+ concatenated frames in one chunk", () => {
    const framer = new Framer();
    const body1 = Buffer.from([1]);
    const body2 = Buffer.from([2, 3]);
    const body3 = Buffer.from([4, 5, 6]);
    const frame1 = makeFrame(10, 0, body1);
    const frame2 = makeFrame(20, 4003, body2);
    const frame3 = makeFrame(30, 0, body3);

    const combined = Buffer.concat([frame1, frame2, frame3]);
    const frames = framer.feed(combined);

    assert.equal(frames.length, 3);
    assert.equal(frames[0].dlen, 1);
    assert.equal(frames[1].status, 4003);
    assert.equal(frames[2].dlen, 3);
  });

  it("handles interleaved partial frames across feeds", () => {
    const framer = new Framer();
    const body1 = Buffer.from([0xaa, 0xbb]);
    const body2 = Buffer.from([0xcc]);
    const frame1 = makeFrame(1, 0, body1);
    const frame2 = makeFrame(2, 0, body2);

    // Feed 1: first half of frame1
    const f1 = framer.feed(frame1.subarray(0, 5));
    assert.equal(f1.length, 0);

    // Feed 2: rest of frame1 + first half of frame2
    const combined = Buffer.concat([frame1.subarray(5), frame2.subarray(0, 5)]);
    const f2 = framer.feed(combined);
    assert.equal(f2.length, 1);
    assert.equal(f2[0].dlen, 2);

    // Feed 3: rest of frame2
    const f3 = framer.feed(frame2.subarray(5));
    assert.equal(f3.length, 1);
    assert.equal(f3[0].dlen, 1);
  });

  it("streamId=0x0000 is parsed correctly", () => {
    const framer = new Framer();
    const frame = makeFrame(0x0000, 0, Buffer.from([1]));
    const frames = framer.feed(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].streamId.readUInt16BE(0), 0);
  });

  it("streamId=0xFFFF is parsed correctly", () => {
    const framer = new Framer();
    const frame = makeFrame(0xffff, 0, Buffer.from([1]));
    const frames = framer.feed(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].streamId.readUInt16BE(0), 0xffff);
  });

  it("status code 4001 (kXR_attn) is parsed correctly", () => {
    const framer = new Framer();
    const body = Buffer.alloc(16);
    body.writeUInt32BE(5008, 0); // actnum
    const frame = makeFrame(42, 4001, body);
    const frames = framer.feed(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].status, 4001);
    assert.equal(frames[0].streamId.readUInt16BE(0), 42);
  });
});
