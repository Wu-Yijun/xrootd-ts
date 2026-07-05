import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCloseRequest,
  buildHandshakeAndProtocol,
  buildLoginRequest,
  buildOpenRequest,
  buildReadRequest,
  buildStatRequest,
  buildWriteRequest,
  parseErrorResponse,
  parseLoginResponse,
  parseOpenResponse,
  parseProtocolResponse,
  parseRedirectResponse,
  parseWaitResponse,
} from "./message.ts";

describe("buildHandshakeAndProtocol", () => {
  it("produces 44 bytes total", () => {
    const buf = buildHandshakeAndProtocol(0);
    assert.equal(buf.length, 44);
  });

  it("contains correct handshake constants", () => {
    const buf = buildHandshakeAndProtocol(0);
    // ClientInitHandShake: first=0, second=0, third=0, fourth=4, fifth=2012
    assert.equal(buf.readInt32BE(0), 0); // first
    assert.equal(buf.readInt32BE(4), 0); // second
    assert.equal(buf.readInt32BE(8), 0); // third
    assert.equal(buf.readInt32BE(12), 4); // fourth
    assert.equal(buf.readInt32BE(16), 2012); // fifth
  });

  it("contains correct protocol request fields", () => {
    const buf = buildHandshakeAndProtocol(0, 0x09, 0x01);
    // Protocol request starts at offset 20
    // streamid (2B) at 20-21
    assert.equal(buf.readUInt16BE(20), 0); // streamId=0
    // requestid (2B) at 22-23 = 3006 (kXR_protocol)
    assert.equal(buf.readUInt16BE(22), 3006);
    // clientpv (4B) at 24-27 = 0x520
    assert.equal(buf.readUInt32BE(24), 0x520);
    // flags (1B) at 28
    assert.equal(buf.readUInt8(28), 0x09);
    // expect (1B) at 29
    assert.equal(buf.readUInt8(29), 0x01);
    // reserved (10B) at 30-39 should be zeros
    for (let i = 30; i < 40; i++) {
      assert.equal(buf[i], 0, `reserved byte at ${i} should be 0`);
    }
    // dlen (4B) at 40-43 = 0
    assert.equal(buf.readUInt32BE(40), 0);
  });
});

describe("buildLoginRequest", () => {
  it("produces correct body layout: pid[4] + username[8] + ability2[1] + ability[1] + capver[1] + reserved[1]", () => {
    const buf = buildLoginRequest(1, 1234, "alice", 0);
    // header: streamid(2) + requestid(2) = 4
    // body at offset 4: pid(4) + username(8) + ability2(1) + ability(1) + capver(1) + reserved(1) = 16
    // dlen at offset 20: 4
    // total = 24

    assert.equal(buf.length, 24);

    // streamid
    assert.equal(buf.readUInt16BE(0), 1);
    // requestid = 3007 (kXR_login)
    assert.equal(buf.readUInt16BE(2), 3007);
    // pid = 1234
    assert.equal(buf.readUInt32BE(4), 1234);
    // username 'alice' padded to 8 bytes
    const username = buf.toString("utf8", 8, 16).replace(/\0+$/, "");
    assert.equal(username, "alice");
    // ability2 = 0
    assert.equal(buf.readUInt8(16), 0);
    // ability = 0
    assert.equal(buf.readUInt8(17), 0);
    // capver = 4
    assert.equal(buf.readUInt8(18), 4);
    // reserved = 0
    assert.equal(buf.readUInt8(19), 0);
    // dlen = 0 (no CGI)
    assert.equal(buf.readUInt32BE(20), 0);
  });

  it("includes CGI string as extra data when provided", () => {
    const cgi = "&appname=test";
    const buf = buildLoginRequest(0, 100, "bob", 0, cgi);
    // header(24) + cgi bytes
    assert.equal(buf.length, 24 + Buffer.byteLength(cgi));
    assert.equal(buf.readUInt32BE(20), Buffer.byteLength(cgi));
    const extra = buf.toString("utf8", 24);
    assert.equal(extra, cgi);
  });
});

describe("buildOpenRequest", () => {
  it("produces header + path in extra data", () => {
    const path = "/data/test.txt";
    const buf = buildOpenRequest(5, path, 0x0010); // kXR_open_read

    assert.equal(buf.readUInt16BE(0), 5); // streamid
    assert.equal(buf.readUInt16BE(2), 3010); // RequestId.Open
    // body: mode(2) + options(2) + optiont(2) + reserved(6) + fhtemplt(4) = 16
    assert.equal(buf.readUInt16BE(4), 0); // mode
    assert.equal(buf.readUInt16BE(6), 0x0010); // options
    assert.equal(buf.readUInt16BE(8), 0); // optiont
    // dlen = path length
    assert.equal(buf.readUInt32BE(20), Buffer.byteLength(path));
    // path starts at offset 24
    const gotPath = buf.toString("utf8", 24);
    assert.equal(gotPath, path);
  });
});

describe("buildReadRequest", () => {
  it("contains fhandle + offset[8] + rlen", () => {
    const fhandle = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const buf = buildReadRequest(3, fhandle, 1024, 4096);

    assert.equal(buf.readUInt16BE(0), 3); // streamid
    assert.equal(buf.readUInt16BE(2), 3013); // RequestId.Read
    // fhandle at 4-7
    assert.deepEqual([...buf.subarray(4, 8)], [0x01, 0x02, 0x03, 0x04]);
    // offset as int64 BE at 8-15
    const high = buf.readInt32BE(8);
    const low = buf.readInt32BE(12);
    assert.equal(high, 0);
    assert.equal(low, 1024);
    // rlen at 16-19
    assert.equal(buf.readUInt32BE(16), 4096);
    // dlen = 0
    assert.equal(buf.readUInt32BE(20), 0);
  });

  it("handles large offset", () => {
    const fhandle = new Uint8Array(4);
    const offset = 0x100000000; // 4GB
    const buf = buildReadRequest(0, fhandle, offset, 100);
    const high = buf.readInt32BE(8);
    const low = buf.readInt32BE(12);
    assert.equal(high, 1);
    assert.equal(low, 0);
  });
});

describe("buildWriteRequest", () => {
  it("contains fhandle + offset[8] + data in extra", () => {
    const fhandle = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = buildWriteRequest(7, fhandle, 2048, data);

    assert.equal(buf.readUInt16BE(0), 7); // streamid
    assert.equal(buf.readUInt16BE(2), 3019); // RequestId.Write
    // fhandle at 4-7
    assert.deepEqual([...buf.subarray(4, 8)], [0xaa, 0xbb, 0xcc, 0xdd]);
    // offset int64 BE at 8-15
    assert.equal(buf.readInt32BE(8), 0);
    assert.equal(buf.readInt32BE(12), 2048);
    // pathid at 16
    assert.equal(buf.readUInt8(16), 0);
    // reserved[3] at 17-19
    // dlen = data.length at 20-23
    assert.equal(buf.readUInt32BE(20), 5);
    // data starts at 24
    assert.deepEqual([...buf.subarray(24, 29)], [1, 2, 3, 4, 5]);
  });
});

describe("buildCloseRequest", () => {
  it("contains fhandle + reserved[12]", () => {
    const fhandle = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
    const buf = buildCloseRequest(2, fhandle);

    assert.equal(buf.readUInt16BE(0), 2); // streamid
    assert.equal(buf.readUInt16BE(2), 3003); // RequestId.Close
    // fhandle at 4-7
    assert.deepEqual([...buf.subarray(4, 8)], [0x11, 0x22, 0x33, 0x44]);
    // reserved[12] at 8-19 should be zeros
    for (let i = 8; i < 20; i++) {
      assert.equal(buf[i], 0);
    }
    // dlen = 0
    assert.equal(buf.readUInt32BE(20), 0);
  });
});

describe("buildStatRequest", () => {
  it("contains path in extra data (stat by path)", () => {
    const path = "/myfile";
    const buf = buildStatRequest(4, path);

    assert.equal(buf.readUInt16BE(0), 4);
    assert.equal(buf.readUInt16BE(2), 3017); // RequestId.Stat
    // body: options(1) + reserved(7) + wants(4) + fhandle(4) = 16
    assert.equal(buf.readUInt8(4), 0); // options
    // dlen at 20
    assert.equal(buf.readUInt32BE(20), Buffer.byteLength(path));
    // path at 24
    assert.equal(buf.toString("utf8", 24), path);
  });

  it("stat by file handle has dlen=0", () => {
    const fhandle = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const buf = buildStatRequest(0, "", fhandle);

    assert.equal(buf.readUInt32BE(20), 0); // dlen = 0
    // fhandle at 16-19
    assert.deepEqual([...buf.subarray(16, 20)], [0xaa, 0xbb, 0xcc, 0xdd]);
  });
});

// ── Response Parsers ────────────────────────────────────────────────────────

describe("parseProtocolResponse", () => {
  it("parses pval + flags", () => {
    const body = Buffer.alloc(8);
    body.writeUInt32BE(0x520, 0); // pval
    body.writeUInt32BE(0x03, 4); // flags
    const resp = parseProtocolResponse(body);
    assert.equal(resp.pval, 0x520);
    assert.equal(resp.flags, 0x03);
    assert.equal(resp.secReqs, undefined);
    assert.equal(resp.bifReqs, undefined);
  });

  it("parses secReqs and bifReqs when present", () => {
    const body = Buffer.alloc(16);
    body.writeUInt32BE(0x520, 0);
    body.writeUInt32BE(0x09, 4);
    Buffer.from("krb5").copy(body, 8);
    const resp = parseProtocolResponse(body);
    assert.equal(resp.pval, 0x520);
    assert.equal(resp.secReqs, "krb5");
  });
});

describe("parseLoginResponse", () => {
  it("parses sessid[16] without secToken", () => {
    const body = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) body[i] = i + 1;
    const resp = parseLoginResponse(body);
    assert.deepEqual([...resp.sessid], [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
    ]);
    assert.equal(resp.needsAuth, false);
    assert.equal(resp.secToken, undefined);
  });

  it("parses sessid + secToken when body > 16", () => {
    const body = Buffer.alloc(20);
    for (let i = 0; i < 16; i++) body[i] = i + 1;
    body[16] = 0xaa;
    body[17] = 0xbb;
    body[18] = 0xcc;
    body[19] = 0xdd;
    const resp = parseLoginResponse(body);
    assert.equal(resp.needsAuth, true);
    assert.deepEqual([...resp.secToken!], [0xaa, 0xbb, 0xcc, 0xdd]);
  });
});

describe("parseOpenResponse", () => {
  it("parses fhandle[4]", () => {
    const body = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const resp = parseOpenResponse(body);
    assert.deepEqual([...resp.fhandle], [0xde, 0xad, 0xbe, 0xef]);
  });
});

describe("parseErrorResponse", () => {
  it("parses errnum + errmsg", () => {
    const msg = "file not found";
    const body = Buffer.alloc(4 + msg.length + 1);
    body.writeUInt32BE(3011, 0);
    Buffer.from(msg, "utf8").copy(body, 4);
    body[4 + msg.length] = 0; // NUL terminator
    const resp = parseErrorResponse(body);
    assert.equal(resp.errnum, 3011);
    assert.equal(resp.errmsg, msg);
  });
});

describe("parseRedirectResponse", () => {
  it("parses port + host", () => {
    const host = "newhost.cern.ch";
    const body = Buffer.alloc(4 + host.length + 1);
    body.writeUInt32BE(1095, 0);
    Buffer.from(host, "utf8").copy(body, 4);
    body[4 + host.length] = 0;
    const resp = parseRedirectResponse(body);
    assert.equal(resp.port, 1095);
    assert.equal(resp.host, host);
  });
});

describe("parseWaitResponse", () => {
  it("parses seconds + infomsg", () => {
    const msg = "try again";
    const body = Buffer.alloc(4 + msg.length + 1);
    body.writeUInt32BE(5, 0);
    Buffer.from(msg, "utf8").copy(body, 4);
    body[4 + msg.length] = 0;
    const resp = parseWaitResponse(body);
    assert.equal(resp.seconds, 5);
    assert.equal(resp.infomsg, msg);
  });
});
