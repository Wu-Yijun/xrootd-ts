import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { handshake } from "../../src/session/handshake.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { registerAuthProtocol } from "../../src/session/auth.ts";
import { HostAuth } from "../../src/security/host.ts";
import { SSSAuth } from "../../src/security/sss.ts";
import type { Session } from "../../src/session/handshake.ts";

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

function parseRequest(message: Buffer): { requestId: number; body: Buffer } {
  const requestId = message.readUInt16BE(2);
  const dlen = message.readUInt32BE(20);
  const body = Buffer.from(message.subarray(24, 24 + dlen));
  return { requestId, body };
}

function createAuthServer(
  secReqs: string,
  authHandler?: (
    credType: number,
    credData: Buffer,
  ) => { ok: boolean; msg?: string },
): Promise<{ server: net.Server; port: number; close: () => void }> {
  return new Promise((resolve) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));

      let buffer = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 24) {
          // Skip ClientInitHandShake (20 B) if merged with first request
          if (
            buffer.length >= 44 &&
            buffer.readUInt32BE(0) === 0 &&
            buffer.readUInt32BE(4) === 0 &&
            buffer.readUInt32BE(8) === 0 &&
            buffer.readUInt32BE(12) === 4 &&
            buffer.readUInt32BE(16) === 2012
          ) {
            buffer = buffer.subarray(20);
          }

          const requestId = buffer.readUInt16BE(2);
          const dlen = buffer.readUInt32BE(20);
          const totalLen = 24 + dlen;

          if (buffer.length < totalLen) break;

          const message = buffer.subarray(0, totalLen);
          buffer = buffer.subarray(totalLen);

          const streamId = (message[0] << 8) | message[1];
          const { body: reqBody } = parseRequest(message);

          if (requestId === 3006) {
            // kXR_protocol - send ServerInitHandShake first, then protocol response
            const initBody = Buffer.alloc(8);
            socket.write(buildResponseFrame(0, 0, initBody));

            // Then the protocol response (pval + flags only, no secReqs struct needed)
            const body = Buffer.alloc(8);
            body.writeUInt32BE(0x520, 0);
            body.writeUInt32BE(0x09, 4);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3007) {
            // kXR_login - send sessid[16] + secToken in &P= format
            const secToken = Buffer.from("&P=" + secReqs + "\0");
            const body = Buffer.alloc(16 + secToken.length);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            secToken.copy(body, 16);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3000) {
            // kXR_auth - credType is in body bytes 12-15, credData is extra data
            const credType = message.readUInt32BE(12);
            const credData = Buffer.from(message.subarray(24));

            if (authHandler) {
              const result = authHandler(credType, credData);
              if (result.ok) {
                socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)));
              } else {
                const errBody = Buffer.alloc(
                  4 + (result.msg?.length ?? 10) + 1,
                );
                errBody.writeUInt32BE(3030, 0);
                Buffer.from(result.msg ?? "Auth failed\0").copy(errBody, 4);
                socket.write(buildResponseFrame(streamId, 4003, errBody));
              }
            } else {
              socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)));
            }
          } else {
            const body = Buffer.alloc(4);
            body.writeUInt32BE(3006, 0);
            socket.write(buildResponseFrame(streamId, 4003, body));
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const close = () => {
        for (const s of sockets) s.destroy();
        server.close();
      };
      resolve({ server, port: addr.port, close });
    });
  });
}

describe("E2E: host authentication", () => {
  it("authenticates with host protocol", async () => {
    const { server, port, close } = await createAuthServer(
      "host",
      (credType, credData) => {
        // host auth sends hostname as credentials
        assert.equal(credType, 0, "credType should be 0 (host)");
        assert.ok(credData.length > 0, "credData should not be empty");
        return { ok: true };
      },
    );

    try {
      registerAuthProtocol("host", () => new HostAuth());

      const transport = new Transport();
      await transport.connect("127.0.0.1", port);
      const mux = new Multiplexer(transport);
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`);

      const session = await handshake(mux, url);

      assert.ok(session, "session should be defined");
      assert.ok(session.sessid, "sessid should be defined");
      assert.equal(session.sessid.length, 16);
      assert.equal(session.needsAuth, true);
      assert.deepEqual(session.authProtocols, ["host"]);

      mux.close();
      await transport.close();
    } finally {
      close();
    }
  });

  it("auth failure sets needsAuth but does not throw", async () => {
    const { port, close } = await createAuthServer("host", () => {
      return { ok: false, msg: "Host not trusted" };
    });

    try {
      registerAuthProtocol("host", () => new HostAuth());

      const transport = new Transport();
      await transport.connect("127.0.0.1", port);
      const mux = new Multiplexer(transport);
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`);

      const session = await handshake(mux, url);
      assert.equal(session.needsAuth, true);
      assert.deepEqual(session.authProtocols, ["host"]);

      mux.close();
      await transport.close();
    } finally {
      close();
    }
  });
});

describe("E2E: unsupported auth protocol", () => {
  it("returns session with authProtocols when no supported protocol", async () => {
    const { port, close } = await createAuthServer("krb5");

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);
      const mux = new Multiplexer(transport);
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`);

      const session = await handshake(mux, url);
      assert.equal(session.needsAuth, true);
      assert.deepEqual(session.authProtocols, ["krb5"]);

      mux.close();
      await transport.close();
    } finally {
      close();
    }
  });
});
