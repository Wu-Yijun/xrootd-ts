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

describe("E2E: redirect flow", () => {
  it("handles kXR_redirect from server A to server B", async () => {
    let serverBCalled = false;

    const serverA = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 24) {
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
            const redirBody = Buffer.alloc(4 + 10);
            redirBody.writeUInt32BE(portB, 0);
            Buffer.from("localhost").copy(redirBody, 4);
            socket.write(buildResponseFrame(streamId, 4004, redirBody));
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      serverA.listen(0, "127.0.0.1", resolve)
    );
    const addrA = serverA.address() as net.AddressInfo;

    const serverB = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= 24) {
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
            serverBCalled = true;
            const body = Buffer.alloc(16);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            socket.write(buildResponseFrame(streamId, 0, body));
          } else if (requestId === 3010) {
            socket.write(
              buildResponseFrame(
                streamId,
                0,
                Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]),
              ),
            );
          } else if (requestId === 3013) {
            socket.write(
              buildResponseFrame(streamId, 0, Buffer.from("Redirected data")),
            );
          } else if (requestId === 3003) {
            socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)));
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      serverB.listen(0, "127.0.0.1", resolve)
    );
    const addrB = serverB.address() as net.AddressInfo;
    const portB = addrB.port;

    try {
      const transport1 = new Transport();
      await transport1.connect("127.0.0.1", addrA.port);

      let capturedRedirPort = 0;
      let mux2: Multiplexer;
      let transport2: Transport;

      const mux1 = new Multiplexer(transport1, {
        maxRedirects: 16,
        onRedirect: async (host, port, pending) => {
          capturedRedirPort = port;
          mux1.close();
          await transport1.close();

          // Connect to server B
          transport2 = new Transport();
          await transport2.connect(host, port);
          mux2 = new Multiplexer(transport2, { maxRedirects: 16 });

          // Retry the original request on the new mux
          mux2.request(pending.requestId, pending.body, pending.data)
            .then(pending.resolve)
            .catch(pending.reject);
        },
      });

      const protoFrame = await mux1.request(3006, new Uint8Array(16));
      assert.equal(protoFrame.status, 0);

      // Login request - server A redirects to server B
      // onRedirect reconnects and retries → should succeed on server B
      const loginFrame = await mux1.request(3007, new Uint8Array(16));
      assert.equal(loginFrame.status, 0);
      assert.equal(capturedRedirPort, portB);

      const session: Session = {
        sessid: new Uint8Array(loginFrame.body.subarray(0, 16)),
        protocolVersion: 0x520,
        needsAuth: false,
      };

      const file = new File(mux2!, session);
      await file.open("/data/test.txt", { flags: 0x0010 });
      assert.equal(file.isOpen, true);

      const data = await file.read(0, 100);
      const text = new TextDecoder().decode(data);
      assert.equal(text, "Redirected data");

      await file.close();
      assert.equal(serverBCalled, true);

      mux2!.close();
      await transport2!.close();
    } finally {
      serverA.close();
      serverB.close();
    }
  });
});
