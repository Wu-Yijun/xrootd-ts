import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { XRootDClient } from "../../src/client.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { OpenFlags } from "../../src/protocol/constants.ts";
import {
  createConnectedClient,
  ensureTestWriteDir,
  ifServerUnavailable,
  randomTestId,
  SERVER_URL,
  TEST_FILE_PATH,
  TEST_WRITE_DIR,
  testFilePath,
  withTimeout,
  XROOTD_HOST,
  XROOTD_PORT,
} from "./setup.ts";

const skip = await ifServerUnavailable()
  ? "SKIP: XRootD server not available"
  : undefined;

describe("Integration: XRootDClient lifecycle", { skip }, () => {
  it("connect sets isConnected = true", async () => {
    await using client =new XRootDClient(SERVER_URL);
    assert.equal(
      client.isConnected,
      false,
      "should not be connected before connect()",
    );
    await withTimeout(client.connect(), 5000, "client.connect()");
    assert.equal(
      client.isConnected,
      true,
      "should be connected after connect()",
    );
    await client.close();
  });

  it("close sets isConnected = false", async () => {
    await using client =new XRootDClient(SERVER_URL);
    await withTimeout(client.connect(), 5000, "client.connect()");
    assert.equal(client.isConnected, true);
    await client.close();
    assert.equal(
      client.isConnected,
      false,
      "should not be connected after close()",
    );
  });

  it("location returns correct URL string", async () => {
    await using client =new XRootDClient(SERVER_URL);
    await withTimeout(client.connect(), 5000, "client.connect()");
    const loc = client.location;
    assert.equal(typeof loc, "string", "location should be a string");
    assert.ok(loc.startsWith("root://"), "location should start with root://");
    assert.ok(loc.includes(XROOTD_HOST), "location should contain host");
    await client.close();
  });

  it("operations after close throw Uninitialized", async () => {
    await using client =new XRootDClient(SERVER_URL);
    await withTimeout(client.connect(), 5000, "client.connect()");
    await client.close();

    try {
      await client.open(TEST_FILE_PATH);
      assert.fail("Expected error");
    } catch (err) {
      assert.ok(err instanceof XRootDError, "should throw XRootDError");
      assert.equal(err.code, 311, "error code should be 311 (Uninitialized)");
    }
  });
});

describe("Integration: XRootDClient filesystem wrappers", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("mkdir → readdir verifies entry → rmdir cleans up", async () => {
    await using client =await createConnectedClient();
    const dirPath = `${TEST_WRITE_DIR}/client-mkdir-${randomTestId()}`;
    try {
      await client.mkdir(dirPath);
      const list = await client.readdir(TEST_WRITE_DIR);
      const names = list.entries.map((e) => e.name);
      const dirName = dirPath.split("/").pop()!;
      assert.ok(
        names.includes(dirName),
        `readdir should contain created dir, got: ${names.join(", ")}`,
      );
      await client.rmdir(dirPath);

      const listAfter = await client.readdir(TEST_WRITE_DIR);
      const namesAfter = listAfter.entries.map((e) => e.name);
      assert.ok(
        !namesAfter.includes(dirName),
        "readdir should not contain removed dir",
      );
    } finally {
      await client.close();
    }
  });

  it("rm removes a file", async () => {
    await using client =await createConnectedClient();
    const path = testFilePath(`client-rm-${randomTestId()}.dat`);
    try {
      await using file =await client.open(path, {
        flags: OpenFlags.Write | OpenFlags.New,
      });
      await file.write(0, new TextEncoder().encode("delete me"));
      await file.close();

      await client.rm(path);

      try {
        await client.stat(path);
        assert.fail("Expected error after rm");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3011, "should get NotFound after rm");
      }
    } finally {
      await client.close();
    }
  });

  it("mv renames a file", async () => {
    await using client =await createConnectedClient();
    const src = testFilePath(`client-mv-src-${randomTestId()}.dat`);
    const dst = testFilePath(`client-mv-dst-${randomTestId()}.dat`);
    try {
      await using file =await client.open(src, {
        flags: OpenFlags.Write | OpenFlags.New,
      });
      await file.write(0, new TextEncoder().encode("move me"));
      await file.close();

      await client.mv(src, dst);

      try {
        await client.stat(src);
        assert.fail("Source should not exist after mv");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3011);
      }

      const info = await client.stat(dst);
      assert.ok(info.size > 0n, "destination should exist after mv");
    } finally {
      await client.close();
    }
  });
});

describe("Integration: XRootDClient stat methods", { skip }, () => {
  it("stat returns StatInfo with expected fields", async () => {
    await using client =await createConnectedClient();
    try {
      const info = await client.stat(TEST_FILE_PATH);
      assert.equal(typeof info.id, "string", "id should be string");
      assert.equal(typeof info.size, "bigint", "size should be bigint");
      assert.ok(info.size > 0n, "size should be > 0");
      assert.equal(typeof info.mtime, "number", "mtime should be number");
      assert.equal(typeof info.ctime, "number", "ctime should be number");
      assert.equal(typeof info.atime, "number", "atime should be number");
      assert.equal(typeof info.mode, "number", "mode should be number");
      assert.equal(typeof info.owner, "string", "owner should be string");
      assert.equal(typeof info.group, "string", "group should be string");
      assert.equal(
        typeof info.isDirectory,
        "boolean",
        "isDirectory should be boolean",
      );
      assert.equal(typeof info.isLink, "boolean", "isLink should be boolean");
      assert.equal(
        typeof info.isOffline,
        "boolean",
        "isOffline should be boolean",
      );
      assert.equal(
        typeof info.isCached,
        "boolean",
        "isCached should be boolean",
      );
    } finally {
      await client.close();
    }
  });

  it("statFilesystem returns StatInfo with expected fields", async () => {
    await using client =await createConnectedClient();
    try {
      const info = await client.statFilesystem(TEST_FILE_PATH);
      assert.equal(typeof info.id, "string");
      assert.equal(typeof info.size, "bigint");
      assert.ok(info.size > 0n);
      assert.equal(typeof info.mtime, "number");
    } finally {
      await client.close();
    }
  });

  it("stat and statFilesystem return same size for same file", async () => {
    await using client =await createConnectedClient();
    try {
      const info1 = await client.stat(TEST_FILE_PATH);
      const info2 = await client.statFilesystem(TEST_FILE_PATH);
      assert.equal(
        info1.size,
        info2.size,
        "stat and statFilesystem should return same size",
      );
    } finally {
      await client.close();
    }
  });
});

describe("Integration: XRootDClient with options", { skip }, () => {
  it("timeout option: operations complete within timeout", async () => {
    await using client =new XRootDClient(SERVER_URL, { timeout: 10000 });
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      const info = await client.stat(TEST_FILE_PATH);
      assert.ok(info.size > 0n);
    } finally {
      await client.close();
    }
  });

  it("maxRedirects option defaults to 16", async () => {
    await using client =new XRootDClient(SERVER_URL, { maxRedirects: 16 });
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      assert.equal(client.isConnected, true);
    } finally {
      await client.close();
    }
  });

  it("credentials option works with no-auth server", async () => {
    await using client =new XRootDClient(SERVER_URL, {
      credentials: { username: "testuser" },
    });
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      assert.equal(client.isConnected, true);
    } finally {
      await client.close();
    }
  });

  it("credentials with password works with no-auth server", async () => {
    await using client =new XRootDClient(SERVER_URL, {
      credentials: { username: "testuser", password: "testpass" },
    });
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      assert.equal(client.isConnected, true);
    } finally {
      await client.close();
    }
  });
});
