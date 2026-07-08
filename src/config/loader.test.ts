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

  it("builds krb5Principal from username + url.host", () => {
    const url = XRootDUrl.parse("root://cern.ch/path");
    const secEnv = new SecEnv({
      env: { XrdSecKRB5INITTKN: "1" },
    });
    const config = loadAuthConfig({
      url,
      credentials: { username: "alice" },
      secEnv,
    });
    assert.equal(config.krb5Principal, "alice@cern.ch");
  });

  it("krb5Principal is undefined when username is undefined", () => {
    const url = XRootDUrl.parse("root://cern.ch/path");
    const secEnv = new SecEnv({
      env: { XrdSecKRB5INITTKN: "1" },
    });
    const config = loadAuthConfig({ url, secEnv });
    assert.equal(config.krb5Principal, undefined);
  });

  it("krb5Principal falls back to 'unknown' when no url", () => {
    const secEnv = new SecEnv({
      env: { XrdSecKRB5INITTKN: "1" },
    });
    const config = loadAuthConfig({
      credentials: { username: "bob" },
      secEnv,
    });
    assert.equal(config.krb5Principal, "bob@unknown");
  });

  it("krb5Principal is undefined when krb5InitToken is false", () => {
    const secEnv = new SecEnv({ env: {} });
    const config = loadAuthConfig({
      credentials: { username: "alice" },
      secEnv,
    });
    assert.equal(config.krb5Principal, undefined);
  });

  it("three sources simultaneously: credentials > url > secEnv", () => {
    const url = XRootDUrl.parse("root://urluser:urlpass@host/path");
    const secEnv = new SecEnv({
      env: { XrdSecUSER: "envuser", XrdSecCREDS: "envpass" },
    });
    const config = loadAuthConfig({
      url,
      credentials: { username: "optuser", password: "optpass" },
      secEnv,
    });
    assert.equal(config.username, "optuser");
    assert.equal(config.password, "optpass");
  });

  it("only username provided, password falls back to url", () => {
    const url = XRootDUrl.parse("root://host:pass@host/path");
    const config = loadAuthConfig({
      credentials: { username: "only_user" },
      url,
    });
    assert.equal(config.username, "only_user");
    assert.equal(config.password, "pass");
  });

  it("sssKeytab and credentials work independently", () => {
    const keyPath = join(tmpDir, "sss2.key");
    writeFileSync(keyPath, Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44]));
    const secEnv = new SecEnv({
      env: { XrdSecSSSKT: keyPath },
    });
    const config = loadAuthConfig({
      credentials: { username: "user", password: "pass" },
      secEnv,
    });
    assert.equal(config.username, "user");
    assert.equal(config.password, "pass");
    assert.ok(config.sssKey);
    assert.equal(config.sssKey.length, 8);
  });
});
