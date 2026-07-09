import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { File } from "../../src/api/file.ts";
import { FileSystem } from "../../src/api/filesystem.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { OpenFlags } from "../../src/protocol/constants.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import {
  closeLowLevel,
  createConnectedLowLevel,
  ensureTestWriteDir,
  ifServerUnavailable,
  randomTestId,
  SERVER_URL,
  TEST_WRITE_DIR,
  testFilePath,
} from "./setup.ts";

const skip = await ifServerUnavailable()
  ? "SKIP: XRootD server not available"
  : undefined;

function createFileForMux(): File {
  return new File({
    url: XRootDUrl.parse(SERVER_URL),
    timeout: 5000,
  });
}

describe("Integration: FileSystem.mkdir", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("mkdir creates a new directory", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const dirPath = `${TEST_WRITE_DIR}/mkdir-${randomTestId()}`;
    try {
      const fs = new FileSystem(() => mux);
      await fs.mkdir(dirPath);

      const info = await fs.stat(dirPath);
      assert.equal(
        info.isDirectory,
        true,
        "created path should be a directory",
      );
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("mkdir on existing path with different mode throws 3018", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const dirPath = `${TEST_WRITE_DIR}/mkdir-mode-conflict-${randomTestId()}`;
    try {
      const fs = new FileSystem(() => mux);
      await fs.mkdir(dirPath, 0o700);
      try {
        await fs.mkdir(dirPath, 0o755);
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3018, "error code should be 3018 (ItExists)");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("mkdir on existing path with same mode succeeds (idempotent)", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const dirPath = `${TEST_WRITE_DIR}/mkdir-idempotent-${randomTestId()}`;
    try {
      const fs = new FileSystem(() => mux);
      await fs.mkdir(dirPath, 0o755);
      await fs.mkdir(dirPath, 0o755);
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("mkdir with custom mode", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const dirPath = `${TEST_WRITE_DIR}/mkdir-mode-${randomTestId()}`;
    try {
      const fs = new FileSystem(() => mux);
      await fs.mkdir(dirPath, 0o755);

      const info = await fs.stat(dirPath);
      assert.equal(info.isDirectory, true);
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: FileSystem.rmdir", { skip }, () => {
  it("rmdir removes an empty directory", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const dirPath = `${TEST_WRITE_DIR}/rmdir-${randomTestId()}`;
    try {
      const fs = new FileSystem(() => mux);
      await fs.mkdir(dirPath);

      const info = await fs.stat(dirPath);
      assert.equal(info.isDirectory, true);

      await fs.rmdir(dirPath);

      try {
        await fs.stat(dirPath);
        assert.fail("Expected error after rmdir");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3011, "should get NotFound after rmdir");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("rmdir on non-existent path succeeds (idempotent)", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const fs = new FileSystem(() => mux);
      await fs.rmdir(`${TEST_WRITE_DIR}/nonexistent-dir-${randomTestId()}`);
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: FileSystem.rm", { skip }, () => {
  it("rm removes an existing file", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const filePath = testFilePath(`rm-${randomTestId()}.dat`);
    try {
      await using writer = createFileForMux();
      await writer.open(filePath, { flags: OpenFlags.Write | OpenFlags.New });
      await writer.write(0, new TextEncoder().encode("to be deleted"));
      await writer.close();

      const fs = new FileSystem(() => mux);
      const info = await fs.stat(filePath);
      assert.ok(info.size > 0n, "file should exist before rm");

      await fs.rm(filePath);

      try {
        await fs.stat(filePath);
        assert.fail("Expected error after rm");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3011, "should get NotFound after rm");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("rm on non-existent path throws XRootDError code 3011", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const fs = new FileSystem(() => mux);
      try {
        await fs.rm(`${TEST_WRITE_DIR}/nonexistent-file-${randomTestId()}.dat`);
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3011, "error code should be 3011 (NotFound)");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: FileSystem.mv", { skip }, () => {
  it("mv renames a file", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const srcPath = testFilePath(`mv-src-${randomTestId()}.dat`);
    const dstPath = testFilePath(`mv-dst-${randomTestId()}.dat`);
    try {
      await using writer = createFileForMux();
      await writer.open(srcPath, { flags: OpenFlags.Write | OpenFlags.New });
      await writer.write(0, new TextEncoder().encode("move me"));
      await writer.close();

      const fs = new FileSystem(() => mux);
      await fs.mv(srcPath, dstPath);

      try {
        await fs.stat(srcPath);
        assert.fail("Source should not exist after mv");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3011, "source should be NotFound");
      }

      const info = await fs.stat(dstPath);
      assert.ok(info.size > 0n, "destination should exist after mv");
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("mv on non-existent source throws XRootDError code 3011", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const fs = new FileSystem(() => mux);
      const src = `${TEST_WRITE_DIR}/nonexistent-mv-${randomTestId()}.dat`;
      const dst = `${TEST_WRITE_DIR}/mv-dst-${randomTestId()}.dat`;
      try {
        await fs.mv(src, dst);
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3011, "error code should be 3011 (NotFound)");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: FileSystem.readdir edge cases", { skip }, () => {
  it("readdir on non-existent path throws error", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const fs = new FileSystem(() => mux);
      try {
        await fs.readdir(`${TEST_WRITE_DIR}/nonexistent-dir-${randomTestId()}`);
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("readdir entries have correct fields (name, size, flags, mtime)", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const fs = new FileSystem(() => mux);
      const list = await fs.readdir(TEST_WRITE_DIR);
      assert.ok(list.entries.length > 0, "should have entries");

      for (const entry of list.entries) {
        assert.equal(
          typeof entry.name,
          "string",
          "entry.name should be string",
        );
        assert.equal(
          typeof entry.size,
          "number",
          "entry.size should be number",
        );
        assert.equal(
          typeof entry.flags,
          "number",
          "entry.flags should be number",
        );
        assert.equal(
          typeof entry.mtime,
          "number",
          "entry.mtime should be number",
        );
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});
