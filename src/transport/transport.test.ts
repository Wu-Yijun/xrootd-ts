import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Transport } from "./transport.ts";

function createEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        socket.write(chunk);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

describe("Transport", () => {
  it("connects to a TCP server", async () => {
    const { server, port } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      // If we got here, connection succeeded
      assert.ok(true);

      await transport.close();
    } finally {
      server.close();
    }
  });

  it("sends and receives data", async () => {
    const { server, port } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      const received = new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        transport.onData((chunk) => {
          chunks.push(chunk);
          resolve(Buffer.concat(chunks));
        });
      });

      const data = Buffer.from("Hello, XRootD!");
      await transport.send(data);

      const result = await received;
      assert.deepEqual(result, data);

      await transport.close();
    } finally {
      server.close();
    }
  });

  it("close destroys the socket", async () => {
    const { server, port } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      await transport.close();

      // Sending after close should fail
      try {
        await transport.send(Buffer.from("test"));
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof Error);
      }
    } finally {
      server.close();
    }
  });

  it("destroy destroys the socket", async () => {
    const { server, port } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      transport.destroy();

      // Sending after destroy should fail
      try {
        await transport.send(Buffer.from("test"));
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof Error);
      }
    } finally {
      server.close();
    }
  });

  it("handles multiple send/receive cycles", async () => {
    const { server, port } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      const receivedBuffers: Buffer[] = [];
      transport.onData((chunk) => {
        receivedBuffers.push(chunk);
      });

      await transport.send(Buffer.from("first"));
      await new Promise((r) => setTimeout(r, 10));

      await transport.send(Buffer.from("second"));
      await new Promise((r) => setTimeout(r, 10));

      await transport.send(Buffer.from("third"));
      await new Promise((r) => setTimeout(r, 50));

      const total = Buffer.concat(receivedBuffers);
      assert.equal(total.toString(), "firstsecondthird");

      await transport.close();
    } finally {
      server.close();
    }
  });
});
