import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SSSAuth } from "./sss.ts";
import type { AuthParams } from "./interface.ts";

const blowfishSupported = SSSAuth.isSupported();

describe("SSSAuth", () => {
  const testKey = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

  const defaultParams: AuthParams = {
    host: "localhost",
    port: 1094,
    username: "testuser",
    password: "secret",
    sessid: new Uint8Array(16),
  };

  it("has correct name", () => {
    const auth = new SSSAuth(testKey);
    assert.equal(auth.name, "sss");
  });

  it("throws on invalid key length", () => {
    assert.throws(
      () => new SSSAuth(Buffer.from([0x01, 0x02])),
      /SSS key must be 8 bytes/,
    );
  });

  it("isSupported() returns whether Blowfish is available", () => {
    assert.equal(typeof SSSAuth.isSupported(), "boolean");
  });

  it("processChallenge marks as complete", async () => {
    const auth = new SSSAuth(testKey);
    assert.equal(auth.isComplete(), false);

    const response = await auth.processChallenge(new Uint8Array(0));
    assert.equal(auth.isComplete(), true);
    assert.equal(response.length, 0);
  });

  it("returns correct entity", () => {
    const auth = new SSSAuth(testKey);
    const entity = auth.getEntity();
    assert.equal(entity.prot, "sss");
    assert.equal(entity.uid, 0);
    assert.equal(entity.gid, 0);
  });

  if (blowfishSupported) {
    it("returns encrypted credentials", async () => {
      const auth = new SSSAuth(testKey);
      const creds = await auth.getCredentials(defaultParams);

      assert.ok(creds.length > 0);
      assert.ok(creds.length % 8 === 0);
    });

    it("different passwords produce different credentials", async () => {
      const auth1 = new SSSAuth(testKey);
      const auth2 = new SSSAuth(testKey);

      const creds1 = await auth1.getCredentials(defaultParams);
      const creds2 = await auth2.getCredentials({
        ...defaultParams,
        password: "different",
      });

      assert.notDeepEqual([...creds1], [...creds2]);
    });

    it("sets username in entity", async () => {
      const auth = new SSSAuth(testKey);
      await auth.getCredentials(defaultParams);

      const entity = auth.getEntity();
      assert.equal(entity.prot, "sss");
      assert.equal(entity.name, "testuser");
    });

    it("handles empty password", async () => {
      const auth = new SSSAuth(testKey);
      const creds = await auth.getCredentials({
        ...defaultParams,
        password: "",
      });

      assert.ok(creds.length > 0);
      assert.ok(creds.length % 8 === 0);
    });
  } else {
    it.skip("Blowfish not supported in this Node.js version", () => {});
    it.skip("Blowfish not supported in this Node.js version", () => {});
    it.skip("Blowfish not supported in this Node.js version", () => {});
    it.skip("Blowfish not supported in this Node.js version", () => {});
  }
});
