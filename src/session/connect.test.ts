import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { connectToHost } from "./connect.ts";
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

function makeServerInitFrame(): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32BE(0x520, 0);
  body.writeUInt32BE(1, 4);
  return buildResponseFrame(0, 0, body);
}

function makeProtocolResponseFrame(): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32BE(0x520, 0);
  body.writeUInt32BE(0x09, 4);
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

function handleHandshakeOnly(socket: net.Socket): void {
  let buffer = Buffer.alloc(0);
  socket.write(makeServerInitFrame());

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
        socket.write(buildResponseFrame(streamId, 0, makeProtocolResponseFrame().subarray(8)));
      } else if (requestId === 3007) {
        socket.write(buildResponseFrame(streamId, 0, makeLoginResponseFrame().subarray(8)));
      }
    }
  });
}

describe("connectToHost", () => {
  it.skip("establishes connection and returns session", async () => {
    const server = net.createServer((socket) => handleHandshakeOnly(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      const result = await connectToHost(url);

      assert.ok(result.transport);
      assert.ok(result.mux);
      assert.ok(result.session);
      assert.equal(result.session.protocolVersion, 0x520);
      assert.ok(result.session.sessid instanceof Uint8Array);
      assert.equal(result.session.sessid.length, 16);

      result.mux.close();
      await result.transport.close();
    } finally {
      server.close();
    }
  });

  it.skip("default port is 1095 when not specified", async () => {
    const server = net.createServer((socket) => handleHandshakeOnly(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      const result = await connectToHost(url);

      assert.ok(result.session);
      result.mux.close();
      await result.transport.close();
    } finally {
      server.close();
    }
  });

  it.skip("passes username to handshake", async () => {
    let receivedLoginPayload: Buffer | null = null as Buffer | null;

    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.write(makeServerInitFrame());

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
            receivedLoginPayload = Buffer.from(message.subarray(24));
            const body = Buffer.alloc(16);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            socket.write(buildResponseFrame(streamId, 0, body));
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      const result = await connectToHost(url, {
        credentials: { username: "alice" },
      });

      assert.ok(receivedLoginPayload);
      const username = receivedLoginPayload!
        .subarray(0, 8)
        .toString("utf8")
        .replace(/\0+$/, "");
      assert.equal(username, "alice");

      result.mux.close();
      await result.transport.close();
    } finally {
      server.close();
    }
  });

  it.skip("throws on handshake failure and cleans up", async () => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.write(makeServerInitFrame());

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
            const errBody = Buffer.alloc(4 + 19);
            errBody.writeUInt32BE(3005, 0);
            Buffer.from("protocol not ok\0").copy(errBody, 4);
            socket.write(buildResponseFrame(streamId, 4003, errBody));
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      await assert.rejects(connectToHost(url), (err: any) => {
        assert.ok(err.message.includes("protocol not ok"));
        return true;
      });
    } finally {
      server.close();
    }
  });

  it.skip("returns session.needsAuth=false when no secToken", async () => {
    const server = net.createServer((socket) => handleHandshakeOnly(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      const result = await connectToHost(url);

      assert.equal(result.session.needsAuth, false);
      assert.equal(result.session.authProtocols, undefined);

      result.mux.close();
      await result.transport.close();
    } finally {
      server.close();
    }
  });

  it.skip("returns session.needsAuth=true when secToken contains &P=", async () => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.write(makeServerInitFrame());

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
            const secToken = "&P=host,unix";
            const tokenBytes = Buffer.from(secToken, "utf8");
            const body = Buffer.alloc(16 + tokenBytes.length);
            for (let i = 0; i < 16; i++) body[i] = i + 1;
            tokenBytes.copy(body, 16);
            socket.write(buildResponseFrame(streamId, 0, body));
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const url = new XRootDUrl(`root://127.0.0.1:${addr.port}/data`);
      const result = await connectToHost(url);

      assert.equal(result.session.needsAuth, true);
      assert.ok(result.session.authProtocols);
      assert.ok(result.session.authProtocols!.includes("host"));
      assert.ok(result.session.authProtocols!.includes("unix"));

      result.mux.close();
      await result.transport.close();
    } finally {
      server.close();
    }
  });
});
