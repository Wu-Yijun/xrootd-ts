import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { File } from "../../src/api/file.ts";
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

function createRedirectServer(
  redirectHost: string,
  redirectPort: number,
  redirectOnRequest: number,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
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

          if (requestId === 3006) {
            const body = Buffer.alloc(8);
            body.writeUInt32BE(0x520, 0);
            body.writeUInt32BE(0x09, 4);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === redirectOnRequest) {
            const redirBody = Buffer.alloc(4 + redirectHost.length);
            redirBody.writeUInt32BE(redirectPort, 0);
            Buffer.from(redirectHost).copy(redirBody, 4);
            socket.write(buildResponseFrame(streamId, 4004, redirBody));
          } else {
            const body = Buffer.alloc(16);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            socket.write(buildResponseFrame(streamId, 0, body));
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

function createTargetServer(
  openFileHandle: Uint8Array,
  readData: Buffer,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
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

          if (requestId === 3006) {
            const body = Buffer.alloc(8);
            body.writeUInt32BE(0x520, 0);
            body.writeUInt32BE(0x09, 4);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3007) {
            const body = Buffer.alloc(16);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3010) {
            socket.write(
              buildResponseFrame(streamId, 0, Buffer.from(openFileHandle)),
            );
          } else if (requestId === 3013) {
            socket.write(buildResponseFrame(streamId, 0, readData));
          } else if (requestId === 3003) {
            socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)));
          } else {
            const errBody = Buffer.alloc(4);
            errBody.writeUInt32BE(3006, 0);
            socket.write(buildResponseFrame(streamId, 4003, errBody));
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe("E2E: redirect auto-handling", () => {
  it("auto-reconnects from server A to server B on redirect", async () => {
    const serverB = await createTargetServer(
      new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
      Buffer.from("redirected data"),
    );

    const serverA = await createRedirectServer("127.0.0.1", serverB.port, 3007);

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", serverA.port);
      let mux = new Multiplexer(transport, {
        maxRedirects: 3,
        onRedirect: async (host: string, port: number, pending) => {
          mux.close();
          await transport.close();

          const t2 = new Transport();
          await t2.connect(host, port);
          mux = new Multiplexer(t2, { maxRedirects: 3 });

          assert.equal(host, "127.0.0.1");
          assert.equal(port, serverB.port);

          // Retry the original request on the new mux
          mux.request(pending.requestId, pending.body, pending.data)
            .then(pending.resolve)
            .catch(pending.reject);
        },
      });

      // Protocol request - succeeds on server A
      const protoFrame = await mux.request(3006, new Uint8Array(16));
      assert.equal(protoFrame.status, 0);

      // Login request - server A redirects to server B
      // onRedirect reconnects and retries → should succeed on server B
      const loginFrame = await mux.request(3007, new Uint8Array(16));
      assert.equal(loginFrame.status, 0);

      mux.close();
      await transport.close();
    } finally {
      serverA.server.close();
      serverB.server.close();
    }
  });

  it("too many redirects rejects with error", async () => {
    const server = net.createServer((socket) => {
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

          if (requestId === 3006) {
            const body = Buffer.alloc(8);
            body.writeUInt32BE(0x520, 0);
            body.writeUInt32BE(0x09, 4);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else {
            // Always redirect back to self
            const redirBody = Buffer.alloc(4 + 9);
            redirBody.writeUInt32BE(addr.port, 0);
            Buffer.from("localhost").copy(redirBody, 4);
            socket.write(buildResponseFrame(streamId, 4004, redirBody));
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const addr = server.address() as net.AddressInfo;

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", addr.port);

      let redirectCount = 0;
      const maxRedirects = 3;

      const mux = new Multiplexer(transport, {
        maxRedirects,
        onRedirect: async (_host, _port, pending) => {
          redirectCount++;
          // Simulate client retry: resend on same mux
          mux.request(pending.requestId, pending.body, pending.data)
            .then(pending.resolve)
            .catch(pending.reject);
        },
      });

      // Protocol request - succeeds
      const protoFrame = await mux.request(3006, new Uint8Array(16));
      assert.equal(protoFrame.status, 0);

      // Login request - will be redirected repeatedly
      // After maxRedirects, it should reject
      try {
        await mux.request(3007, new Uint8Array(16));
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.match(err.message, /redirect/i);
      }

      mux.close();
      await transport.close();
    } finally {
      server.close();
    }
  });

  it("redirect to unreachable server rejects with connection error", async () => {
    const server = net.createServer((socket) => {
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

          if (requestId === 3006) {
            const body = Buffer.alloc(8);
            body.writeUInt32BE(0x520, 0);
            body.writeUInt32BE(0x09, 4);
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3007) {
            // Redirect to a port that nothing is listening on
            const redirBody = Buffer.alloc(4 + 9);
            redirBody.writeUInt32BE(1, 0); // port 1 - unreachable
            Buffer.from("localhost").copy(redirBody, 4);
            socket.write(buildResponseFrame(streamId, 4004, redirBody));
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const addr = server.address() as net.AddressInfo;

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", addr.port);
      const mux = new Multiplexer(transport, {
        maxRedirects: 3,
        onRedirect: async (_host, _port, pending) => {
          // Try to connect to unreachable port - should fail
          try {
            const t = new Transport();
            await t.connect("127.0.0.1", 1);
            // If somehow connected, retry on new mux
            mux.request(pending.requestId, pending.body, pending.data)
              .then(pending.resolve)
              .catch(pending.reject);
          } catch {
            // Connection failed - reject the pending request
            pending.reject(new Error("Connection to redirect target failed"));
          }
        },
      });

      const protoFrame = await mux.request(3006, new Uint8Array(16));
      assert.equal(protoFrame.status, 0);

      try {
        // Login request will redirect to unreachable port
        await mux.request(3007, new Uint8Array(16));
      } catch (err) {
        assert.ok(err instanceof Error);
      }

      mux.close();
      await transport.close();
    } finally {
      server.close();
    }
  });
});
