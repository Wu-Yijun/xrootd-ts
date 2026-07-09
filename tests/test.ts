import { XRootDClient } from "xrootd";
import assert from "node:assert";
import { describe, it } from "node:test";


export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) =>
      timer = setTimeout(
        () => reject(new Error(`Timeout after ${ms}ms: ${label}`)),
        ms,
      )
    ),
  ]);
}


describe("Integration: XRootDClient filesystem operations", () => {
  it("client.statFilesystem returns valid info", async () => {
    await using client = new XRootDClient(`root://localhost:1094/`);
    try {
      await withTimeout(client.connect(), 5000, "client.connect()");
      const info = await client.statFilesystem("/data/test/testfile.txt");
      assert.ok(info.size > 0n, "file size should be > 0");
      assert.ok(info.mtime > 0, "mtime should be > 0");
    } finally {
      await client.close();
    }
  });

  it("client.readdir returns directory listing", async () => {
    await using client = new XRootDClient(`root://localhost:1094/`);
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
