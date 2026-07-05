import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { doAuthentication, registerAuthProtocol } from "./auth.ts";
import { Multiplexer } from "../transport/multiplexer.ts";
import type { ITransport } from "../transport/interface.ts";
import type {
  AuthParams,
  SecEntity,
  SecurityProtocol,
} from "../security/interface.ts";
import { ResponseStatus } from "../protocol/constants.ts";

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

class MockTransport implements ITransport {
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

  removeDataHandler(_callback: (chunk: Buffer) => void): void {}

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  simulateResponse(status: number, body: Buffer): void {
    if (this.dataCallback && this.sentData.length > 0) {
      const lastReq = this.sentData[this.sentData.length - 1];
      const sid = extractStreamId(lastReq);
      this.dataCallback(buildResponseFrame(sid, status, body));
    }
  }
}

class MockAuthProtocol implements SecurityProtocol {
  readonly name = "host";
  private creds: Uint8Array;
  private complete = false;
  private entity: SecEntity;

  constructor(creds: Uint8Array, entity?: Partial<SecEntity>) {
    this.creds = creds;
    this.entity = {
      prot: "host",
      name: "testuser",
      uid: 1000,
      gid: 1000,
      ...entity,
    };
  }

  async getCredentials(_params: AuthParams): Promise<Uint8Array> {
    return this.creds;
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    this.complete = true;
    return new Uint8Array([0x01, 0x02]);
  }

  isComplete(): boolean {
    return this.complete;
  }

  getEntity(): SecEntity {
    return this.entity;
  }
}

describe("Auth Framework", () => {
  let transport: MockTransport;
  let mux: Multiplexer;

  beforeEach(() => {
    transport = new MockTransport();
    mux = new Multiplexer(transport);
  });

  afterEach(() => {
    mux.close();
  });

  it("skips authentication when no protocols required", async () => {
    const params: AuthParams = {
      host: "localhost",
      port: 1094,
      username: "test",
      sessid: new Uint8Array(16),
    };

    const entity = await doAuthentication(mux, [], params);
    assert.equal(entity.prot, "");
  });

  it("authenticates with supported protocol", async () => {
    registerAuthProtocol(
      "host",
      () => new MockAuthProtocol(new Uint8Array([0xaa, 0xbb])),
    );

    const params: AuthParams = {
      host: "localhost",
      port: 1094,
      username: "test",
      sessid: new Uint8Array(16),
    };

    const responsePromise = doAuthentication(mux, ["host"], params);

    await sleep(1);
    transport.simulateResponse(0, Buffer.alloc(0));

    const entity = await responsePromise;
    assert.equal(entity.prot, "host");
    assert.equal(entity.name, "testuser");
  });

  it("throws when no supported protocol", async () => {
    const params: AuthParams = {
      host: "localhost",
      port: 1094,
      username: "test",
      sessid: new Uint8Array(16),
    };

    await assert.rejects(
      () => doAuthentication(mux, ["unsupported"], params),
      (err: any) => err.code === 3030,
    );
  });

  it("handles multi-round authentication", async () => {
    const multiRoundCreds = [new Uint8Array([0x01]), new Uint8Array([0x02])];
    let callCount = 0;

    class MultiRoundAuth implements SecurityProtocol {
      readonly name = "sss";

      async getCredentials(): Promise<Uint8Array> {
        return multiRoundCreds[callCount++];
      }

      async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
        return new Uint8Array([0x03]);
      }

      isComplete(): boolean {
        return callCount >= 2;
      }

      getEntity(): SecEntity {
        return { prot: "sss", uid: 0, gid: 0 };
      }
    }

    registerAuthProtocol("sss", () => new MultiRoundAuth());

    const params: AuthParams = {
      host: "localhost",
      port: 1094,
      username: "test",
      sessid: new Uint8Array(16),
    };

    const responsePromise = doAuthentication(mux, ["sss"], params);

    await sleep(1);
    // First authmore
    transport.simulateResponse(4002, Buffer.alloc(0));
    await sleep(1);
    // Second authmore
    transport.simulateResponse(4002, Buffer.alloc(0));
    await sleep(1);
    // Final ok
    transport.simulateResponse(0, Buffer.alloc(0));

    const entity = await responsePromise;
    assert.equal(entity.prot, "sss");
  });

  it("throws on auth failure", async () => {
    registerAuthProtocol(
      "host",
      () => new MockAuthProtocol(new Uint8Array([0x01])),
    );

    const params: AuthParams = {
      host: "localhost",
      port: 1094,
      username: "test",
      sessid: new Uint8Array(16),
    };

    const responsePromise = doAuthentication(mux, ["host"], params);

    await sleep(1);
    // Send error response
    const errBody = Buffer.alloc(4 + 10);
    errBody.writeInt32BE(3030, 0);
    errBody.write("Auth failed", 4, "utf8");
    transport.simulateResponse(4003, errBody);

    await assert.rejects(responsePromise, (err: any) => err.code === 3030);
  });
});
