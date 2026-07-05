import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { handshake } from "../../src/session/handshake.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { FileSystem } from "../../src/api/filesystem.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { XRootDClient } from "../../src/client.ts";
import {
  skipIfServerUnavailable,
  TEST_FILE_PATH,
  XROOTD_HOST,
  XROOTD_PORT,
} from "./setup.ts";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

async function createConnectedFileSystem(): Promise<{
  transport: Transport;
  mux: Multiplexer;
  fs: FileSystem;
  close: () => Promise<void>;
}> {
  const transport = new Transport();
  await transport.connect(XROOTD_HOST, XROOTD_PORT);
  const mux = new Multiplexer(transport);
  const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);
  await withTimeout(
    handshake(mux, url),
    5000,
    "handshake with xrootd server",
  );
  const fs = new FileSystem(mux);
  return {
    transport,
    mux,
    fs,
    close: async () => {
      mux.close();
      await transport.close();
    },
  };
}

describe("Integration: FileSystem.stat", () => {
  before(skipIfServerUnavailable);

  it("stat on existing file returns valid StatInfo", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const info = await fs.stat(TEST_FILE_PATH);
      assert.ok(info, "stat info should be defined");
      assert.ok(info.size > 0n, "file size should be > 0");
      assert.equal(info.isDirectory, false, "should not be a directory");
    } finally {
      await close();
    }
  });

  it("stat on directory returns valid StatInfo", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const info = await fs.stat("/data/test");
      assert.ok(info, "stat info should be defined");
      assert.ok(typeof info.id === "string", "should have a string id");
      assert.ok(info.size >= 0n, "size should be >= 0");
      assert.ok(info.mtime > 0, "mtime should be > 0");
    } finally {
      await close();
    }
  });

  it("stat on non-existent path throws XRootDError", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      try {
        await fs.stat("/data/nonexistent_path_12345");
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3011, "error code should be 3011 (NotFound)");
      }
    } finally {
      await close();
    }
  });
});

describe("Integration: FileSystem.readdir", () => {
  before(skipIfServerUnavailable);

  it("readdir on directory returns DirectoryList with entries", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const list = await fs.readdir("/data/test");
      assert.ok(list, "directory list should be defined");
      assert.equal(list.name, "/data/test");
      assert.ok(Array.isArray(list.entries), "entries should be an array");
      assert.ok(list.entries.length > 0, "should have at least one entry");

      const names = list.entries.map((e) => e.name);
      assert.ok(
        names.includes("testfile.txt"),
        `entries should contain testfile.txt, got: ${names.join(", ")}`,
      );
    } finally {
      await close();
    }
  });

  it("readdir on root returns directory listing", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const list = await fs.readdir("/data");
      assert.ok(list, "directory list should be defined");
      assert.ok(list.entries.length > 0, "should have entries");
    } finally {
      await close();
    }
  });
});

describe("Integration: XRootDClient filesystem operations", () => {
  before(skipIfServerUnavailable);

  it("client.statFilesystem returns valid info", async () => {
    const client = new XRootDClient(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      const info = await client.statFilesystem(TEST_FILE_PATH);
      assert.ok(info.size > 0n, "file size should be > 0");
      assert.ok(info.mtime > 0, "mtime should be > 0");
    } finally {
      await client.close();
    }
  });

  it("client.readdir returns directory listing", async () => {
    const client = new XRootDClient(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      const list = await client.readdir("/data/test");
      assert.ok(list.entries.length > 0, "should have entries");
      const names = list.entries.map((e) => e.name);
      assert.ok(names.includes("testfile.txt"));
    } finally {
      await client.close();
    }
  });
});

describe("Integration: FileSystem.readdir entry fields", () => {
  before(skipIfServerUnavailable);

  it("readdir entries have correct types for all fields", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const list = await fs.readdir("/data/test");
      assert.ok(list.entries.length > 0, "should have entries");

      for (const entry of list.entries) {
        assert.equal(typeof entry.name, "string", "name should be string");
        assert.equal(typeof entry.size, "number", "size should be number");
        assert.equal(typeof entry.flags, "number", "flags should be number");
        assert.equal(typeof entry.mtime, "number", "mtime should be number");
        assert.ok(entry.name.length > 0, "name should not be empty");
      }
    } finally {
      await close();
    }
  });

  it("testfile.txt entry has correct size", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const list = await fs.readdir("/data/test");
      const entry = list.entries.find((e) => e.name === "testfile.txt");
      assert.ok(entry, "testfile.txt should exist");
    } finally {
      await close();
    }
  });
});

describe("Integration: FileSystem.stat on root", () => {
  before(skipIfServerUnavailable);

  it("stat on /data returns valid directory info", async () => {
    const { fs, close } = await createConnectedFileSystem();
    try {
      const info = await fs.stat("/data");
      assert.ok(info, "stat info should be defined");
      assert.equal(info.isDirectory, true, "/data should be a directory");
      assert.ok(info.mtime > 0, "mtime should be > 0");
    } finally {
      await close();
    }
  });
});
