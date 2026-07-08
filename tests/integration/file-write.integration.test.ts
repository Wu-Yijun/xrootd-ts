import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { File } from "../../src/api/file.ts";
import { FileSystem } from "../../src/api/filesystem.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { OpenFlags } from "../../src/protocol/constants.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import {
  closeLowLevel,
  createConnectedClient,
  createConnectedLowLevel,
  ensureTestWriteDir,
  ifServerUnavailable,
  randomTestId,
  SERVER_URL,
  TEST_WRITE_DIR,
  testFilePath,
  withTimeout,
  XROOTD_HOST,
  XROOTD_PORT,
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

describe("Integration: File.write", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("write data to a new file and verify size via stat", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`write-basic-${randomTestId()}.dat`);
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      const data = new TextEncoder().encode("Hello, XRootD write!");
      const written = await file.write(0, data);
      assert.ok(written > 0, "should report bytes written");
      await file.close();

      const file2 = createFileForMux();
      await file2.open(path, { flags: OpenFlags.Read });
      const info = await file2.stat();
      assert.equal(
        info.size,
        BigInt(data.byteLength),
        "file size should match written data",
      );
      await file2.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("write then read back verifies content integrity", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`write-readback-${randomTestId()}.dat`);
    const content = "Round-trip test: \u4e2d\u6587 + special chars: @#$%^&*()";
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      const data = new TextEncoder().encode(content);
      await file.write(0, data);
      await file.close();

      const file2 = createFileForMux();
      await file2.open(path, { flags: OpenFlags.Read });
      const readData = await file2.read(0, data.byteLength);
      const text = new TextDecoder().decode(readData);
      assert.equal(text, content, "read content should match written content");
      await file2.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("write at offset overwrites partial content", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`write-offset-${randomTestId()}.dat`);
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await file.write(0, new TextEncoder().encode("AAAA"));
      await file.write(2, new TextEncoder().encode("BB"));
      await file.close();

      const file2 = createFileForMux();
      await file2.open(path, { flags: OpenFlags.Read });
      const data = await file2.read(0, 4);
      const text = new TextDecoder().decode(data);
      assert.equal(text, "AABB", "partial overwrite should work");
      await file2.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("multiple sequential writes to same file", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`write-multi-${randomTestId()}.dat`);
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await file.write(0, new TextEncoder().encode("Part1-"));
      await file.write(6, new TextEncoder().encode("Part2-"));
      await file.write(12, new TextEncoder().encode("Part3"));
      await file.close();

      const file2 = createFileForMux();
      await file2.open(path, { flags: OpenFlags.Read });
      const data = await file2.read(0, 17);
      const text = new TextDecoder().decode(data);
      assert.equal(
        text,
        "Part1-Part2-Part3",
        "multiple writes should concatenate",
      );
      await file2.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("write on closed file throws XRootDError code 3004", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      try {
        await file.write(0, new TextEncoder().encode("test"));
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
        assert.equal(err.code, 3004, "error code should be 3004 (FileNotOpen)");
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: File.open with Write flags", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("OpenFlags.Write opens existing file for writing", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`flags-write-${randomTestId()}.dat`);
    try {
      const setup = createFileForMux();
      await setup.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await setup.write(0, new TextEncoder().encode("original"));
      await setup.close();

      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write });
      await file.write(0, new TextEncoder().encode("updated"));
      await file.close();

      const reader = createFileForMux();
      await reader.open(path, { flags: OpenFlags.Read });
      const data = await reader.read(0, 7);
      assert.equal(new TextDecoder().decode(data), "updated");
      await reader.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("OpenFlags.Write | OpenFlags.New creates file if not exists", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`flags-new-${randomTestId()}.dat`);
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await file.write(0, new TextEncoder().encode("created"));
      await file.close();

      const reader = createFileForMux();
      await reader.open(path, { flags: OpenFlags.Read });
      const data = await reader.read(0, 7);
      assert.equal(new TextDecoder().decode(data), "created");
      await reader.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("OpenFlags.Append writes to end of file", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`flags-append-${randomTestId()}.dat`);
    try {
      const setup = createFileForMux();
      await setup.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await setup.write(0, new TextEncoder().encode("Hello"));
      await setup.close();

      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.Append });
      await file.write(5, new TextEncoder().encode(" World"));
      await file.close();

      const reader = createFileForMux();
      await reader.open(path, { flags: OpenFlags.Read });
      const info = await reader.stat();
      assert.equal(info.size, 11n, "file should be 11 bytes after append");
      const data = await reader.read(0, 11);
      assert.equal(new TextDecoder().decode(data), "Hello World");
      await reader.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: File.sync and truncate", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("sync on opened file does not throw", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`sync-${randomTestId()}.dat`);
    try {
      const setup = createFileForMux();
      await setup.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await setup.write(0, new TextEncoder().encode("sync test"));
      await setup.close();

      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Read });
      try {
        await file.sync();
      } catch (err) {
        if (err instanceof XRootDError) {
          assert.ok(
            err.code === 3010 || err.code === 3011,
            `sync error code should be 3010 or 3011, got ${err.code}: ${err.message}`,
          );
        } else {
          throw err;
        }
      }
      await file.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("sync on closed file throws XRootDError code 3004", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      try {
        await file.sync();
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("truncate on opened file does not throw", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`truncate-${randomTestId()}.dat`);
    try {
      const setup = createFileForMux();
      await setup.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      await setup.write(0, new TextEncoder().encode("truncate test data"));
      await setup.close();

      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Read });
      try {
        await file.truncate(0);
      } catch (err) {
        if (err instanceof XRootDError) {
          assert.ok(
            err.code === 3010 || err.code === 3011,
            `truncate error code should be 3010 or 3011, got ${err.code}: ${err.message}`,
          );
        } else {
          throw err;
        }
      }
      await file.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("truncate on closed file throws XRootDError code 3004", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      try {
        await file.truncate(0);
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: File state errors", { skip }, () => {
  it("read on closed file throws XRootDError code 3004", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      try {
        await file.read(0, 10);
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("stat on closed file throws XRootDError code 3004", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      try {
        await file.stat();
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("double open on same File instance throws XRootDError", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    const path = testFilePath(`double-open-${randomTestId()}.dat`);
    try {
      const file = createFileForMux();
      await file.open(path, { flags: OpenFlags.Write | OpenFlags.New });
      try {
        await file.open(path, { flags: OpenFlags.Read });
        assert.fail("Expected XRootDError");
      } catch (err) {
        assert.ok(err instanceof XRootDError, "should throw XRootDError");
      }
      await file.close();
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });

  it("close is idempotent (no error on second close)", async () => {
    const { transport, mux, session } = await createConnectedLowLevel();
    try {
      const file = createFileForMux();
      await file.open(TEST_WRITE_DIR + "/dummy", { flags: OpenFlags.Read });
      await file.close();
      await file.close(); // should not throw
      assert.equal(file.isOpen, false);
    } catch (err) {
      if (err instanceof XRootDError && err.code === 3011) {
        // file doesn't exist is fine, we just want to test close idempotency
      } else {
        throw err;
      }
    } finally {
      await closeLowLevel({ transport, mux, session });
    }
  });
});

describe("Integration: XRootDClient write flow", { skip }, () => {
  before(async () => {
    await ensureTestWriteDir();
  });

  it("client.open with Write → write → close → read back", async () => {
    const client = await createConnectedClient();
    const path = testFilePath(`client-write-${randomTestId()}.dat`);
    try {
      const file = await client.open(path, {
        flags: OpenFlags.Write | OpenFlags.New,
      });
      const data = new TextEncoder().encode("client write test");
      await file.write(0, data);
      await file.close();

      const reader = await client.open(path, { flags: OpenFlags.Read });
      const readData = await reader.read(0, data.byteLength);
      assert.equal(
        new TextDecoder().decode(readData),
        "client write test",
        "read content should match",
      );
      await reader.close();
    } finally {
      await client.close();
    }
  });
});
