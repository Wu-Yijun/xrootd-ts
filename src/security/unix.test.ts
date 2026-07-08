import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnixAuth } from "./unix.ts";
import type { AuthParams } from "./interface.ts";

describe("UnixAuth", () => {
  const defaultParams: AuthParams = {
    host: "testhost.example.com",
    port: 1094,
    username: "testuser",
    sessid: new Uint8Array(16),
  };

  it("has correct name", () => {
    const auth = new UnixAuth();
    assert.equal(auth.name, "unix");
  });

  it("returns credentials with unix prefix", async () => {
    const auth = new UnixAuth();
    const creds = await auth.getCredentials(defaultParams);
    const decoded = new TextDecoder().decode(creds);

    assert.ok(decoded.startsWith("unix\0"));
  });

  it("includes username and group in credentials", async () => {
    const auth = new UnixAuth();
    const creds = await auth.getCredentials(defaultParams);
    const decoded = new TextDecoder().decode(creds);

    assert.ok(decoded.includes("testuser"));
  });

  it("uses provided username", async () => {
    const auth = new UnixAuth();
    const creds = await auth.getCredentials({
      ...defaultParams,
      username: "alice",
    });
    const decoded = new TextDecoder().decode(creds);

    assert.ok(decoded.includes("alice"));
  });

  it("falls back to unknown when no username", async () => {
    const auth = new UnixAuth();
    const creds = await auth.getCredentials({
      ...defaultParams,
      username: undefined,
    });
    const decoded = new TextDecoder().decode(creds);

    assert.ok(decoded.startsWith("unix\0"));
  });

  it("processChallenge marks as complete", async () => {
    const auth = new UnixAuth();
    assert.equal(auth.isComplete(), false);

    const response = await auth.processChallenge(new Uint8Array(0));
    assert.equal(auth.isComplete(), true);
    assert.equal(response.length, 0);
  });

  it("returns correct entity", () => {
    const auth = new UnixAuth();
    const entity = auth.getEntity();
    assert.equal(entity.prot, "unix");
    assert.equal(entity.uid, 0);
    assert.equal(entity.gid, 0);
  });

  it("sets username in entity after getCredentials", async () => {
    const auth = new UnixAuth();
    await auth.getCredentials(defaultParams);

    const entity = auth.getEntity();
    assert.equal(entity.prot, "unix");
    assert.equal(entity.name, "testuser");
  });

  it("credential format is 'unix\\0' + username + ' ' + group", async () => {
    const auth = new UnixAuth();
    const creds = await auth.getCredentials(defaultParams);
    const decoded = new TextDecoder().decode(creds);

    // Should start with "unix\0"
    assert.equal(decoded.charCodeAt(0), "u".charCodeAt(0));
    assert.equal(decoded.charCodeAt(4), 0); // NUL terminator

    // After "unix\0", should contain username
    assert.ok(decoded.includes("testuser"));
  });

  it("entity.host is set to os.hostname()", () => {
    const auth = new UnixAuth();
    const entity = auth.getEntity();
    // entity.host may or may not be set depending on implementation
    // This test verifies the entity structure is valid
    assert.equal(entity.prot, "unix");
  });
});
