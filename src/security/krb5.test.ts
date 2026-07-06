import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Krb5Auth } from "./krb5.ts";
import type { AuthParams } from "./interface.ts";

describe("Krb5Auth", () => {
  const defaultParams: AuthParams = {
    host: "testhost.example.com",
    port: 1094,
    username: "testuser",
    sessid: new Uint8Array(16),
  };

  it("has correct name", () => {
    const auth = new Krb5Auth();
    assert.equal(auth.name, "krb5");
  });

  it("isSupported() returns whether kerberos package is available", () => {
    assert.equal(typeof Krb5Auth.isSupported(), "boolean");
  });

  it("processChallenge marks as complete", async () => {
    const auth = new Krb5Auth();
    assert.equal(auth.isComplete(), false);

    const response = await auth.processChallenge(new Uint8Array(0));
    assert.equal(auth.isComplete(), true);
    assert.equal(response.length, 0);
  });

  it("returns correct entity", () => {
    const auth = new Krb5Auth();
    const entity = auth.getEntity();
    assert.equal(entity.prot, "krb5");
    assert.equal(entity.uid, 0);
    assert.equal(entity.gid, 0);
  });

  // Skip credential tests when kerberos is not available
  if (Krb5Auth.isSupported()) {
    it("returns credentials with krb5 prefix", async () => {
      const auth = new Krb5Auth();
      const creds = await auth.getCredentials(defaultParams);
      const decoded = new TextDecoder().decode(creds.slice(0, 4));

      assert.equal(decoded, "krb5");
    });

    it("credentials include kerberos token", async () => {
      const auth = new Krb5Auth();
      const creds = await auth.getCredentials(defaultParams);

      // Kerberos tokens are typically > 4 bytes (prefix) + token
      assert.ok(creds.length > 4);
    });

    it("sets username in entity after getCredentials", async () => {
      const auth = new Krb5Auth();
      await auth.getCredentials(defaultParams);

      const entity = auth.getEntity();
      assert.equal(entity.prot, "krb5");
      assert.equal(entity.name, "testuser");
    });
  } else {
    it.skip("Kerberos not available - install kerberos package and kinit", () => {});
    it.skip("Kerberos not available - install kerberos package and kinit", () => {});
    it.skip("Kerberos not available - install kerberos package and kinit", () => {});
  }
});
