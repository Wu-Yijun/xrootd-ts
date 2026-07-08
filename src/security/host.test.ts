import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HostAuth } from "./host.ts";
import type { AuthParams } from "./interface.ts";

describe("HostAuth", () => {
  const defaultParams: AuthParams = {
    host: "testhost.example.com",
    port: 1094,
    username: "testuser",
    sessid: new Uint8Array(16),
  };

  it("has correct name", () => {
    const auth = new HostAuth();
    assert.equal(auth.name, "host");
  });

  it("returns fixed 'host\\0' as credentials", async () => {
    const auth = new HostAuth();
    const creds = await auth.getCredentials(defaultParams);
    const decoded = new TextDecoder().decode(creds);
    assert.equal(decoded, "host\0");
  });

  it("returns fixed 'host\\0' regardless of host param", async () => {
    const auth = new HostAuth();
    const creds = await auth.getCredentials({ ...defaultParams, host: "" });
    const decoded = new TextDecoder().decode(creds);
    assert.equal(decoded, "host\0");
  });

  it("processChallenge marks as complete", async () => {
    const auth = new HostAuth();
    assert.equal(auth.isComplete(), false);

    const response = await auth.processChallenge(new Uint8Array(0));
    assert.equal(auth.isComplete(), true);
    assert.equal(response.length, 0);
  });

  it("returns correct entity", () => {
    const auth = new HostAuth();
    const entity = auth.getEntity();
    assert.equal(entity.prot, "host");
    assert.equal(entity.uid, 0);
    assert.equal(entity.gid, 0);
  });

  it("credentials contain NUL terminator", async () => {
    const auth = new HostAuth();
    const creds = await auth.getCredentials(defaultParams);
    // "host\0" = [104, 111, 115, 116, 0]
    assert.equal(creds[4], 0x00);
    assert.equal(creds.length, 5);
  });

  it("multiple getCredentials calls are idempotent", async () => {
    const auth = new HostAuth();
    const creds1 = await auth.getCredentials(defaultParams);
    const creds2 = await auth.getCredentials(defaultParams);
    assert.deepEqual([...creds1], [...creds2]);
  });
});
