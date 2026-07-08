import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handshake } from "./handshake.ts";
import { Multiplexer } from "../transport/multiplexer.ts";
import { XRootDUrl } from "../url/url.ts";

function buildResponseFrame(
  streamId: number,
  status: number,
  body: Buffer,
): Buffer {
  const hdr = Buffer.alloc(8);
  hdr.writeUInt16BE(streamId, 0);
  hdr.writeUInt16BE(status, 2);
  hdr.writeUInt32BE(body.length, 4);
  return Buffer.concat([hdr, body]);
}

function extractStreamId(buf: Buffer): number {
  return (buf[0] << 8) | buf[1];
}

class MockTransportForHandshake {
  private dataCallback: ((chunk: Buffer) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;
  sentData: Buffer[] = [];

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  destroy(): void {}

  async send(data: Buffer): Promise<void> {
    this.sentData.push(Buffer.from(data));
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.dataCallback = callback;
  }

  removeDataHandler(callback: (chunk: Buffer) => void): void {
    if (this.dataCallback === callback) {
      this.dataCallback = null;
    }
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  emit(data: Buffer): void {
    this.dataCallback?.(data);
  }
}

function makeServerInitFrame(): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32BE(0x520, 0); // protover
  body.writeUInt32BE(1, 4); // msgval (DataServer)
  return buildResponseFrame(0, 0, body);
}

function makeProtocolResponseFrame(): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32BE(0x520, 0); // pval
  body.writeUInt32BE(0x09, 4); // flags
  return buildResponseFrame(0, 0, body);
}

function makeLoginResponseFrame(secToken?: string): Buffer {
  if (secToken) {
    const tokenBytes = Buffer.from(secToken, "utf8");
    const body = Buffer.alloc(16 + tokenBytes.length);
    for (let i = 0; i < 16; i++) body[i] = i + 1;
    tokenBytes.copy(body, 16);
    return buildResponseFrame(0, 0, body);
  }
  const body = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) body[i] = i + 1;
  return buildResponseFrame(0, 0, body);
}

function makeErrorResponseFrame(
  streamId: number,
  errnum: number,
  errmsg: string,
): Buffer {
  const errBody = Buffer.alloc(4 + errmsg.length + 1);
  errBody.writeUInt32BE(errnum, 0);
  Buffer.from(errmsg, "utf8").copy(errBody, 4);
  errBody[4 + errmsg.length] = 0;
  return buildResponseFrame(streamId, 4003, errBody);
}

function makeRedirectResponseFrame(
  streamId: number,
  port: number,
  host: string,
): Buffer {
  const body = Buffer.alloc(4 + host.length);
  body.writeInt32BE(port, 0);
  Buffer.from(host, "utf8").copy(body, 4);
  return buildResponseFrame(streamId, 4004, body);
}

describe("handshake", () => {
  it("returns Session with correct sessid and protocolVersion", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url, { username: "test", pid: 1234 });

    // Let the handshake register its frame reader handler and send the handshake
    await new Promise((r) => setTimeout(r, 10));

    // Step 1: send ServerInitHandShake frame
    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    // Step 2: send kXR_ok + protocol response
    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));

    // Step 3: send kXR_ok + sessid[16]
    transport.emit(makeLoginResponseFrame());

    const session = await sessionPromise;

    assert.equal(session.protocolVersion, 0x520);
    assert.equal(session.needsAuth, false);
    assert.equal(session.authProtocols, undefined);
    assert.deepEqual([...session.sessid], [
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

    mux.close();
  });

  it("sends correct handshake + protocol in first send", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeLoginResponseFrame());

    await sessionPromise;

    // First send should be 44 bytes (20 handshake + 24 protocol)
    const firstSend = transport.sentData[0];
    assert.equal(firstSend.length, 44);

    // Verify handshake fields
    assert.equal(firstSend.readInt32BE(0), 0); // first
    assert.equal(firstSend.readInt32BE(4), 0); // second
    assert.equal(firstSend.readInt32BE(8), 0); // third
    assert.equal(firstSend.readInt32BE(12), 4); // fourth
    assert.equal(firstSend.readInt32BE(16), 2012); // fifth

    // Verify protocol request
    assert.equal(firstSend.readUInt16BE(22), 3006); // kXR_protocol
    assert.equal(firstSend.readUInt32BE(24), 0x520); // clientpv

    mux.close();
  });

  it("sends login request as second send", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url, { username: "alice", pid: 42 });

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeLoginResponseFrame());

    await sessionPromise;

    // Second send should be login request
    const loginSend = transport.sentData[1];
    assert.equal(loginSend.readUInt16BE(2), 3007); // kXR_login
    assert.equal(loginSend.readUInt32BE(4), 42); // pid
    const username = loginSend.toString("utf8", 8, 16).replace(/\0+$/, "");
    assert.equal(username, "alice");

    mux.close();
  });

  it("returns authProtocols from login secToken", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));
    // Login response with secToken
    transport.emit(makeLoginResponseFrame("&P=host&P=sss"));

    const session = await sessionPromise;

    assert.equal(session.needsAuth, true);
    assert.deepEqual(session.authProtocols, ["host", "sss"]);

    mux.close();
  });

  it("throws on protocol error response", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeErrorResponseFrame(0, 3006, "protocol not supported"));

    await assert.rejects(
      sessionPromise,
      (err: any) => err.message.includes("Protocol handshake error"),
    );

    mux.close();
  });

  it("throws on login error response", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeErrorResponseFrame(0, 3010, "not authorized"));

    await assert.rejects(
      sessionPromise,
      (err: any) => err.message.includes("Login error"),
    );

    mux.close();
  });

  it("throws on login redirect response", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeServerInitFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeProtocolResponseFrame());

    await new Promise((r) => setTimeout(r, 10));

    transport.emit(makeRedirectResponseFrame(0, 1095, "other.server.com"));

    await assert.rejects(
      sessionPromise,
      (err: any) => err.message.includes("redirect"),
    );

    mux.close();
  });

  it("uses default username='' and pid=process.pid when no options", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeProtocolResponseFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeLoginResponseFrame());

    await sessionPromise;

    // Second send should be login request with default values
    const loginSend = transport.sentData[1];
    assert.equal(loginSend.readUInt16BE(2), 3007); // kXR_login
    const username = loginSend.toString("utf8", 8, 16).replace(/\0+$/, "");
    assert.equal(username, ""); // default empty username
    assert.ok(loginSend.readUInt32BE(4) > 0); // pid should be process.pid

    mux.close();
  });

  it("parses seclvl from protocol response secReqs struct", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));

    // Protocol response with secReqs struct containing seclvl
    const body = Buffer.alloc(8 + 6);
    body.writeUInt32BE(0x520, 0); // pval
    body.writeUInt32BE(0x09, 4); // flags
    body[8] = 0x53; // tag 'S'
    body[9] = 0; // rsvd
    body[10] = 0; // secver
    body[11] = 1; // secopt
    body[12] = 3; // seclvl (intense)
    body[13] = 0; // secvsz
    transport.emit(buildResponseFrame(0, 0, body));

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeLoginResponseFrame());

    const session = await sessionPromise;
    assert.equal(session.seclvl, 3);

    mux.close();
  });

  it("parses bifReqs from protocol response", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));

    // Protocol response with bifReqs struct
    const bifInfo = "krb5,host";
    const body = Buffer.alloc(8 + 4 + bifInfo.length);
    body.writeUInt32BE(0x520, 0); // pval
    body.writeUInt32BE(0x09, 4); // flags
    body[8] = 0x42; // tag 'B'
    body[9] = 0; // rsvd
    body.writeUInt16BE(bifInfo.length, 10); // bifILen
    Buffer.from(bifInfo).copy(body, 12);
    transport.emit(buildResponseFrame(0, 0, body));

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeLoginResponseFrame());

    const session = await sessionPromise;
    assert.equal(session.bifReqs, "krb5,host");

    mux.close();
  });

  it("parses spnPrefix from secToken", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeProtocolResponseFrame());
    await new Promise((r) => setTimeout(r, 10));

    // Login response with krb5 SPN in secToken
    transport.emit(
      makeLoginResponseFrame(
        "&P=krb5,host/eos07.ihep.ac.cn@IHEPKRB5&P=unix",
      ),
    );

    const session = await sessionPromise;
    assert.equal(session.spnPrefix, "host");

    mux.close();
  });

  it("spnPrefix is undefined when no krb5 entry in secToken", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeProtocolResponseFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeLoginResponseFrame("&P=host&P=unix"));

    const session = await sessionPromise;
    assert.equal(session.spnPrefix, undefined);

    mux.close();
  });

  it("throws on unexpected protocol response status", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));

    // Send unexpected status (e.g. 4001 kXR_attn)
    transport.emit(buildResponseFrame(0, 4001, Buffer.alloc(16)));

    await assert.rejects(
      sessionPromise,
      (err: any) => err.message.includes("Unexpected protocol response status"),
    );

    mux.close();
  });

  it("throws on unexpected login response status", async () => {
    const transport = new MockTransportForHandshake();
    const mux = new Multiplexer(transport as any);
    const url = new XRootDUrl("root://host.cern.ch/data");

    const sessionPromise = handshake(mux, url);

    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeServerInitFrame());
    await new Promise((r) => setTimeout(r, 10));
    transport.emit(makeProtocolResponseFrame());
    await new Promise((r) => setTimeout(r, 10));

    // Send unexpected status (e.g. 4002 kXR_authmore)
    transport.emit(buildResponseFrame(0, 4002, Buffer.alloc(0)));

    await assert.rejects(
      sessionPromise,
      (err: any) => err.message.includes("Unexpected login response status"),
    );

    mux.close();
  });
});
