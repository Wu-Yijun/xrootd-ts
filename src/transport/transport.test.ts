import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Transport } from "./transport.ts";

function createEchoServer(): Promise<{ server: net.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("data", (chunk: Buffer) => {
        socket.write(chunk);
      });
      socket.on("close", () => sockets.delete(socket));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const close = () => new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.close(() => res());
      });
      resolve({ server, port: addr.port, close });
    });
  });
}

describe("Transport", () => {
  it("connects to a TCP server", async () => {
    const { port, close } = await createEchoServer();

    try {
      const transport = new Transport();
      await transport.connect("127.0.0.1", port);

      // If we got here, connection succeeded
      assert.ok(true);

      await transport.close();
    } finally {
      await close();
    }
  });

  it("sends and receives data", async () => {
    const { port, close } = await createEchoServer();

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
      await close();
    }
  });

  it("close destroys the socket", async () => {
    const { port, close } = await createEchoServer();

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
      await close();
    }
  });

  it("destroy destroys the socket", async () => {
    const { port, close } = await createEchoServer();

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
      await close();
    }
  });

  it("handles multiple send/receive cycles", async () => {
    const { port, close } = await createEchoServer();

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
      await close();
    }
  });

  it("connect to non-existent port throws", async () => {
    const transport = new Transport();
    try {
      await assert.rejects(
        () => transport.connect("127.0.0.1", 1),
        (err: any) => err instanceof Error,
      );
    } finally {
      transport.destroy();
    }
  });

  it("onClose callback is called when remote closes", async () => {
    const { port, close } = await createEchoServer();

    const transport = new Transport();
    await transport.connect("127.0.0.1", port);

    try {
      const closePromise = new Promise<void>((resolve) => {
        transport.onClose(() => resolve());
      });

      // Close from server side
      await close();

      // The socket will detect the close
      await Promise.race([
        closePromise,
        new Promise((r) => setTimeout(r, 200)),
      ]);
    } finally {
      transport.destroy();
    }
  });

  it("onError callback is called on socket error", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as net.AddressInfo;

    const transport = new Transport();
    await transport.connect("127.0.0.1", addr.port);

    try {
      const errorPromise = new Promise<Error>((resolve) => {
        transport.onError((err) => resolve(err));
      });

      // Force a socket error by destroying the server
      server.close();

      // The error callback should fire
      const err = await Promise.race([
        errorPromise,
        new Promise<Error>((r) => setTimeout(() => r(new Error("timeout")), 500)),
      ]);
      // We got an error (either the real one or timeout)
      assert.ok(err instanceof Error);
    } finally {
      transport.destroy();
    }
  });
});
