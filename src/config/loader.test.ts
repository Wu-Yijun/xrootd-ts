import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuthConfig } from "./loader.ts";
import { SecEnv } from "./sec-env.ts";
import { XRootDUrl } from "../url/url.ts";

const tmpDir = join(tmpdir(), "xrootd-test-loader");

before(() => {
  mkdirSync(tmpDir, { recursive: true });
});

after(() => {
  try {
    unlinkSync(join(tmpDir, "sss.key"));
  } catch {
    // ignore
  }
});

describe("loadAuthConfig", () => {
  it("returns empty config with no inputs", () => {
    const config = loadAuthConfig({});
    assert.equal(config.username, undefined);
    assert.equal(config.password, undefined);
    assert.equal(config.sssKey, undefined);
  });

  it("prefers credentials over URL", () => {
    const url = XRootDUrl.parse("root://urluser:urlpass@host/path");
    const config = loadAuthConfig({
      url,
      credentials: { username: "optuser", password: "optpass" },
    });
    assert.equal(config.username, "optuser");
    assert.equal(config.password, "optpass");
  });

  it("falls back to URL userinfo", () => {
    const url = XRootDUrl.parse("root://urluser:urlpass@host/path");
    const config = loadAuthConfig({ url });
    assert.equal(config.username, "urluser");
    assert.equal(config.password, "urlpass");
  });

  it("falls back to SecEnv XrdSecUSER/XrdSecCREDS", () => {
    const secEnv = new SecEnv({
      env: { XrdSecUSER: "envuser", XrdSecCREDS: "envpass" },
    });
    const config = loadAuthConfig({ secEnv });
    assert.equal(config.username, "envuser");
    assert.equal(config.password, "envpass");
  });

  it("reads SSS keytab file when available", () => {
    const keyPath = join(tmpDir, "sss.key");
    writeFileSync(keyPath, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    const secEnv = new SecEnv({
      env: { XrdSecSSSKT: keyPath },
    });
    const config = loadAuthConfig({ secEnv });
    assert.ok(config.sssKey);
    assert.equal(config.sssKey.length, 8);
    assert.deepEqual([...config.sssKey!], [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("returns undefined sssKey when keytab file does not exist", () => {
    const secEnv = new SecEnv({
      env: { XrdSecSSSKT: "/nonexistent/path/key" },
    });
    const config = loadAuthConfig({ secEnv });
    assert.equal(config.sssKey, undefined);
  });

  it("username/password defaults to undefined when all sources empty", () => {
    const url = XRootDUrl.parse("root://host/path");
    const config = loadAuthConfig({ url });
    assert.equal(config.username, undefined);
    assert.equal(config.password, undefined);
  });
});
