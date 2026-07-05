import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  get16,
  get32,
  getBytes,
  getString,
  put16,
  put32,
  putBytes,
  putString,
} from "./codec.ts";

describe("put16 / get16", () => {
  it("round-trips uint16 values", () => {
    const buf = Buffer.alloc(4);
    put16(buf, 0, 0x1234);
    put16(buf, 2, 0x0000);

    const [v1, off1] = get16(buf, 0);
    const [v2, off2] = get16(buf, 2);

    assert.equal(v1, 0x1234);
    assert.equal(off1, 2);
    assert.equal(v2, 0);
    assert.equal(off2, 4);
  });

  it("writes big-endian byte order", () => {
    const buf = Buffer.alloc(2);
    put16(buf, 0, 0x0102);
    assert.equal(buf[0], 0x01);
    assert.equal(buf[1], 0x02);
  });

  it("returns new offset", () => {
    const buf = Buffer.alloc(4);
    const off = put16(buf, 0, 0xabcd);
    assert.equal(off, 2);
  });
});

describe("put32 / get32", () => {
  it("round-trips uint32 values", () => {
    const buf = Buffer.alloc(8);
    put32(buf, 0, 0xdeadbeef);
    put32(buf, 4, 0);

    const [v1, off1] = get32(buf, 0);
    const [v2, off2] = get32(buf, 4);

    assert.equal(v1, 0xdeadbeef >>> 0);
    assert.equal(off1, 4);
    assert.equal(v2, 0);
    assert.equal(off2, 8);
  });

  it("writes big-endian byte order", () => {
    const buf = Buffer.alloc(4);
    put32(buf, 0, 0x01020304);
    assert.equal(buf[0], 0x01);
    assert.equal(buf[1], 0x02);
    assert.equal(buf[2], 0x03);
    assert.equal(buf[3], 0x04);
  });

  it("returns new offset", () => {
    const buf = Buffer.alloc(4);
    const off = put32(buf, 0, 12345);
    assert.equal(off, 4);
  });
});

describe("putString / getString", () => {
  it("round-trips a string with null padding", () => {
    const buf = Buffer.alloc(16);
    const off = putString(buf, 0, "hello", 8);

    assert.equal(off, 8);

    const [str, strOff] = getString(buf, 0, 8);
    assert.equal(str, "hello");
    assert.equal(strOff, 8);
  });

  it("truncates strings longer than maxLen", () => {
    const buf = Buffer.alloc(8);
    putString(buf, 0, "hello world", 8);

    const [str] = getString(buf, 0, 8);
    assert.equal(str, "hello wo");
  });

  it("pads short strings with zeros", () => {
    const buf = Buffer.alloc(8);
    putString(buf, 0, "hi", 8);

    assert.equal(buf[2], 0);
    assert.equal(buf[3], 0);
    assert.equal(buf[7], 0);
  });

  it("round-trips empty string", () => {
    const buf = Buffer.alloc(4);
    putString(buf, 0, "", 4);

    const [str] = getString(buf, 0, 4);
    assert.equal(str, "");
  });

  it("getString trims trailing null bytes", () => {
    const buf = Buffer.alloc(8);
    buf.write("abc", 0, "utf8");
    buf.fill(0, 3, 8); // pad with zeros

    const [str] = getString(buf, 0, 8);
    assert.equal(str, "abc");
  });
});

describe("putBytes / getBytes", () => {
  it("round-trips raw bytes", () => {
    const src = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const buf = Buffer.alloc(8);
    const off = putBytes(buf, 0, src);

    assert.equal(off, 4);

    const [got, gotOff] = getBytes(buf, 0, 4);
    assert.equal(gotOff, 4);
    assert.deepEqual([...got], [0xde, 0xad, 0xbe, 0xef]);
  });

  it("copies into correct offset", () => {
    const buf = Buffer.alloc(8);
    putBytes(buf, 4, new Uint8Array([0xaa, 0xbb]));

    const [got] = getBytes(buf, 4, 2);
    assert.deepEqual([...got], [0xaa, 0xbb]);
  });

  it("returns new offset after putBytes", () => {
    const buf = Buffer.alloc(10);
    const off = putBytes(buf, 3, new Uint8Array([1, 2, 3]));
    assert.equal(off, 6);
  });
});
