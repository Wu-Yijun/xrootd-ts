import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { handshake } from "../../src/session/handshake.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { File } from "../../src/api/file.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { XRootDClient } from "../../src/client.ts";
import type { Session } from "../../src/session/handshake.ts";
import {
  EXPECTED_FILE_CONTENTS,
  ifServerUnavailable,
  TEST_FILE_PATH,
  XROOTD_HOST,
  XROOTD_PORT,
  withTimeout
} from "./setup.ts";

const skip = await ifServerUnavailable()
  ? "SKIP: XRootD server not available"
  : undefined;

async function createConnectedClient(): Promise<{
  transport: Transport;
  mux: Multiplexer;
  session: Session;
}> {
  const transport = new Transport();
  await transport.connect(XROOTD_HOST, XROOTD_PORT);
  const mux = new Multiplexer(transport);
  const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);
  const session = await withTimeout(
    handshake(mux, url),
    5000,
    "handshake with xrootd server",
  );
  return { transport, mux, session };
}

describe("Integration: file read flow", { skip }, () => {
  it("login -> open -> read -> close", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);
      assert.equal(file.isOpen, true, "file should be open");

      const data = await file.read(0, EXPECTED_FILE_CONTENTS.length);
      const text = new TextDecoder().decode(data);
      assert.equal(text, EXPECTED_FILE_CONTENTS);

      await file.close();
      assert.equal(file.isOpen, false, "file should be closed");
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("read with offset and size", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const data = await file.read(0, 5);
      const text = new TextDecoder().decode(data);
      assert.equal(text, "Hello");

      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("read with offset skips bytes", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const data = await file.read(7, 6);
      const text = new TextDecoder().decode(data);
      assert.equal(text, "XRootD");

      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("open non-existent file throws XRootDError", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);

      try {
        await file.open("/data/nonexistent_file_12345.txt");
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3011, "error code should be 3011 (NotFound)");
      }
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("stat on opened file returns valid info", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const info = await file.stat();
      assert.ok(info, "stat info should be defined");
      assert.ok(info.size > 0n, "file size should be > 0");
      assert.equal(
        info.size,
        BigInt(Buffer.byteLength(EXPECTED_FILE_CONTENTS)),
        "size should match content length",
      );

      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("multiple sequential reads", async () => {
    const { transport, mux, session } = await createConnectedClient();

    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const chunk1 = await file.read(0, 5);
      const chunk2 = await file.read(5, 5);
      const chunk3 = await file.read(10, 5);

      assert.equal(new TextDecoder().decode(chunk1), "Hello");
      assert.equal(new TextDecoder().decode(chunk2), ", XRo");
      assert.equal(new TextDecoder().decode(chunk3), "otD!\n");

      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });
});

describe("Integration: XRootDClient file operations", { skip }, () => {
  it("client.open -> read -> close", async () => {
    const client = new XRootDClient(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);

    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      assert.equal(client.isConnected, true);

      const file = await client.open(TEST_FILE_PATH);
      assert.equal(file.isOpen, true);

      const data = await file.read(0, 5);
      const text = new TextDecoder().decode(data);
      assert.equal(text, "Hello");

      await file.close();
      assert.equal(file.isOpen, false);
    } finally {
      await client.close();
      assert.equal(client.isConnected, false);
    }
  });

  it("client.stat returns valid info", async () => {
    const client = new XRootDClient(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);

    try {
      await withTimeout(client.connect(), 5000, "client.connect()");

      const info = await client.stat(TEST_FILE_PATH);
      assert.ok(info.size > 0n, "file size should be > 0");
    } finally {
      await client.close();
    }
  });

  it("client.open non-existent file throws", async () => {
    const client = new XRootDClient(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);

    try {
      await withTimeout(client.connect(), 5000, "client.connect()");

      try {
        await client.open("/data/nonexistent_file_12345.txt");
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.ok(
          err.code === 3011 || err.code === 3010,
          `error code should be 3011 (NotFound) or 3010 (NotAuthorized), got ${err.code}`,
        );
      }
    } finally {
      await client.close();
    }
  });
});

describe("Integration: file read edge cases", { skip }, () => {
  it("read with size larger than file returns available bytes", async () => {
    const { transport, mux, session } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const actualSize = Buffer.byteLength(EXPECTED_FILE_CONTENTS);
      const data = await file.read(0, actualSize + 1000);
      assert.ok(data.length > 0, "should return some data");
      assert.ok(
        data.length <= actualSize,
        `should not return more than file size: got ${data.length}, file is ${actualSize}`,
      );

      const text = new TextDecoder().decode(data);
      assert.ok(text.startsWith("Hello"), "should start with file content");
      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("read at offset near end returns fewer bytes", async () => {
    const { transport, mux, session } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const actualSize = Buffer.byteLength(EXPECTED_FILE_CONTENTS);
      const offset = actualSize - 5;
      const data = await file.read(offset, 1000);

      const expected = EXPECTED_FILE_CONTENTS.slice(offset);
      const text = new TextDecoder().decode(data);
      assert.equal(text, expected, "should read only remaining bytes");
      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });

  it("sequential reads produce consistent results", async () => {
    const { transport, mux, session } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      const data1 = await file.read(0, 10);
      const data2 = await file.read(0, 10);

      assert.deepEqual(
        Array.from(data1),
        Array.from(data2),
        "two reads from same offset should return same data",
      );
      await file.close();
    } finally {
      mux.close();
      await transport.close();
    }
  });
});
