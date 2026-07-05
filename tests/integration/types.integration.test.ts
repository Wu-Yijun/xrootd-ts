import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { File } from "../../src/api/file.ts";
import { FileSystem } from "../../src/api/filesystem.ts";
import { XRootDError } from "../../src/api/errors.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { createStatInfo } from "../../src/api/types.ts";
import {
  OpenFlags,
  ServerError,
  ClientError,
  StatFlags,
  DirlistOptions,
  CRED_TYPE,
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  S_IFDIR,
  S_IFLNK,
} from "../../src/protocol/constants.ts";
import {
  skipIfServerUnavailable,
  createConnectedLowLevel,
  closeLowLevel,
  createConnectedClient,
  TEST_FILE_PATH,
  SERVER_URL,
  XROOTD_HOST,
  XROOTD_PORT,
} from "./setup.ts";

describe("Integration: StatInfo type validation", () => {
  before(skipIfServerUnavailable);

  it("stat returns StatInfo with correct types for all fields", async () => {
    const client = await createConnectedClient();
    try {
      const info = await client.stat(TEST_FILE_PATH);

      assert.equal(typeof info.id, "string", "id should be string");
      assert.equal(typeof info.size, "bigint", "size should be bigint");
      assert.equal(typeof info.flags, "number", "flags should be number");
      assert.equal(typeof info.mtime, "number", "mtime should be number");
      assert.equal(typeof info.ctime, "number", "ctime should be number");
      assert.equal(typeof info.atime, "number", "atime should be number");
      assert.equal(typeof info.mode, "number", "mode should be number");
      assert.equal(typeof info.owner, "string", "owner should be string");
      assert.equal(typeof info.group, "string", "group should be string");

      assert.equal(typeof info.isDirectory, "boolean", "isDirectory should be boolean");
      assert.equal(typeof info.isLink, "boolean", "isLink should be boolean");
      assert.equal(typeof info.isOffline, "boolean", "isOffline should be boolean");
      assert.equal(typeof info.isCached, "boolean", "isCached should be boolean");
    } finally {
      await client.close();
    }
  });

  it("stat on directory sets isDirectory = true", async () => {
    const client = await createConnectedClient();
    try {
      const info = await client.stat("/data/test");
      assert.equal(info.isDirectory, true, "should be a directory");
    } finally {
      await client.close();
    }
  });

  it("stat on file sets isDirectory = false", async () => {
    const client = await createConnectedClient();
    try {
      const info = await client.stat(TEST_FILE_PATH);
      assert.equal(info.isDirectory, false, "should not be a directory");
    } finally {
      await client.close();
    }
  });

  it("createStatInfo parser returns correct types", () => {
    const statStr = "12345 6789 3 1700000000 1700000100 1700000200 100644 root group";
    const info = createStatInfo(statStr);

    assert.equal(typeof info.id, "string");
    assert.equal(info.id, "12345");
    assert.equal(typeof info.size, "bigint");
    assert.equal(info.size, 6789n);
    assert.equal(info.flags, 3);
    assert.equal(info.mtime, 1700000000);
    assert.equal(info.ctime, 1700000100);
    assert.equal(info.atime, 1700000200);
    assert.equal(info.mode, 0o100644);
    assert.equal(info.owner, "root");
    assert.equal(info.group, "group");
  });

  it("createStatInfo detects directory from mode", () => {
    const statStr = "1 100 2 0 0 0 40755 root root";
    const info = createStatInfo(statStr);
    assert.equal(info.isDirectory, true);
  });

  it("createStatInfo detects symlink from mode", () => {
    const statStr = "1 10 0 0 0 0 120777 root root";
    const info = createStatInfo(statStr);
    assert.equal(info.isLink, true);
  });
});

describe("Integration: DirectoryEntry type validation", () => {
  before(skipIfServerUnavailable);

  it("readdir entries have correct types", async () => {
    const client = await createConnectedClient();
    try {
      const list = await client.readdir("/data/test");
      assert.ok(list.entries.length > 0, "should have entries");

      for (const entry of list.entries) {
        assert.equal(typeof entry.name, "string", "name should be string");
        assert.equal(typeof entry.size, "number", "size should be number");
        assert.equal(typeof entry.flags, "number", "flags should be number");
        assert.equal(typeof entry.mtime, "number", "mtime should be number");
        assert.ok(entry.name.length > 0, "name should not be empty");
      }
    } finally {
      await client.close();
    }
  });

  it("readdir name matches requested path", async () => {
    const client = await createConnectedClient();
    try {
      const list = await client.readdir("/data/test");
      assert.equal(list.name, "/data/test", "list.name should match requested path");
    } finally {
      await client.close();
    }
  });
});

describe("Integration: OpenFlags constants", () => {
  it("OpenFlags enum values are correct", () => {
    assert.equal(OpenFlags.Compress, 0x0001);
    assert.equal(OpenFlags.Delete, 0x0002);
    assert.equal(OpenFlags.Force, 0x0004);
    assert.equal(OpenFlags.New, 0x0008);
    assert.equal(OpenFlags.Read, 0x0010);
    assert.equal(OpenFlags.Write, 0x0020);
    assert.equal(OpenFlags.Async, 0x0040);
    assert.equal(OpenFlags.Refresh, 0x0080);
    assert.equal(OpenFlags.Mkpath, 0x0100);
    assert.equal(OpenFlags.Append, 0x0200);
    assert.equal(OpenFlags.Retstat, 0x0400);
    assert.equal(OpenFlags.Replica, 0x0800);
    assert.equal(OpenFlags.Posc, 0x1000);
    assert.equal(OpenFlags.Nowait, 0x2000);
    assert.equal(OpenFlags.Seqio, 0x4000);
    assert.equal(OpenFlags.Wrto, 0x8000);
  });

  it("OpenFlags can be combined with bitwise OR", () => {
    const flags = OpenFlags.Write | OpenFlags.New;
    assert.equal(flags, 0x0020 | 0x0008);
    assert.equal(flags, 0x0028);
  });
});

describe("Integration: StatFlags constants", () => {
  it("StatFlags enum values are correct", () => {
    assert.equal(StatFlags.XBitSet, 1);
    assert.equal(StatFlags.IsDir, 2);
    assert.equal(StatFlags.Other, 4);
    assert.equal(StatFlags.Offline, 8);
    assert.equal(StatFlags.Readable, 16);
    assert.equal(StatFlags.Writable, 32);
    assert.equal(StatFlags.POSCPending, 64);
    assert.equal(StatFlags.BackUpExists, 128);
    assert.equal(StatFlags.CacheResp, 512);
  });
});

describe("Integration: DirlistOptions constants", () => {
  it("DirlistOptions values are correct", () => {
    assert.equal(DirlistOptions.Online, 1);
    assert.equal(DirlistOptions.Dstat, 2);
    assert.equal(DirlistOptions.Dcksm, 4);
    assert.equal(DirlistOptions.Dstatx, 8);
  });
});

describe("Integration: XRootDError class", () => {
  it("codeToMessage returns correct messages for known codes", () => {
    assert.equal(XRootDError.codeToMessage(ServerError.NotFound), "File not found");
    assert.equal(XRootDError.codeToMessage(ServerError.NotAuthorized), "Permission denied");
    assert.equal(XRootDError.codeToMessage(ServerError.ItExists), "File already exists");
    assert.equal(XRootDError.codeToMessage(ServerError.IsDirectory), "Is a directory");
    assert.equal(XRootDError.codeToMessage(ClientError.Timeout), "Request timed out");
    assert.equal(XRootDError.codeToMessage(ClientError.Disconnected), "Connection closed unexpectedly");
  });

  it("codeToMessage returns fallback for unknown codes", () => {
    const msg = XRootDError.codeToMessage(9999);
    assert.ok(msg.includes("9999"), "should contain the code number");
  });

  it("error instances have correct name and code", () => {
    const err = new XRootDError(ServerError.NotFound, "custom message");
    assert.equal(err.name, "XRootDError");
    assert.equal(err.code, ServerError.NotFound);
    assert.equal(err.message, "custom message");
    assert.equal(err.errno, undefined);
  });

  it("error with errno preserves it", () => {
    const err = new XRootDError(ServerError.IOError, "io error", 5);
    assert.equal(err.errno, 5);
  });
});

describe("Integration: XRootDUrl class", () => {
  it("parse root://host:port/path", () => {
    const url = new XRootDUrl("root://myhost:1095/data");
    assert.equal(url.protocol, "root");
    assert.equal(url.host, "myhost");
    assert.equal(url.port, 1095);
    assert.equal(url.path, "/data");
  });

  it("parse roots://host/path (secure)", () => {
    const url = new XRootDUrl("roots://myhost/data");
    assert.equal(url.protocol, "roots");
    assert.equal(url.isSecure(), true);
    assert.equal(url.isValid(), true);
  });

  it("parse root://host with default port", () => {
    const url = new XRootDUrl("root://myhost/data");
    assert.equal(url.port, DEFAULT_PORT);
  });

  it("parse root://user:pass@host/path", () => {
    const url = new XRootDUrl("root://admin:secret@myhost/data");
    assert.equal(url.user, "admin");
    assert.equal(url.password, "secret");
  });

  it("getChannelId returns host:port", () => {
    const url = new XRootDUrl("root://myhost:1095/data");
    assert.equal(url.getChannelId(), "myhost:1095");
  });

  it("getLocation returns protocol://host:port/path", () => {
    const url = new XRootDUrl("root://myhost:1095/data");
    assert.equal(url.getLocation(), "root://myhost:1095/data");
  });

  it("toString reconstructs URL", () => {
    const url = new XRootDUrl("root://myhost:1095/data");
    const str = url.toString();
    assert.ok(str.includes("root://"), "should contain protocol");
    assert.ok(str.includes("myhost"), "should contain host");
    assert.ok(str.includes("/data"), "should contain path");
  });

  it("isValid returns true for root:// and roots://", () => {
    assert.equal(new XRootDUrl("root://host/path").isValid(), true);
    assert.equal(new XRootDUrl("roots://host/path").isValid(), true);
  });

  it("static parse creates instance", () => {
    const url = XRootDUrl.parse("root://host/path");
    assert.ok(url instanceof XRootDUrl);
    assert.equal(url.host, "host");
  });
});

describe("Integration: Protocol constants", () => {
  it("PROTOCOL_VERSION is 5.2.0", () => {
    assert.equal(PROTOCOL_VERSION, 0x00000520);
  });

  it("DEFAULT_PORT is 1094", () => {
    assert.equal(DEFAULT_PORT, 1094);
  });

  it("S_IFDIR and S_IFLNK are correct POSIX mode flags", () => {
    assert.equal(S_IFDIR, 0o040000);
    assert.equal(S_IFLNK, 0o120000);
  });

  it("CRED_TYPE maps auth protocol names to numbers", () => {
    assert.equal(CRED_TYPE["host"], 0);
    assert.equal(CRED_TYPE["sss"], 1);
    assert.equal(CRED_TYPE["unix"], 2);
    assert.equal(CRED_TYPE["krb5"], 3);
    assert.equal(CRED_TYPE["gsi"], 4);
  });
});
