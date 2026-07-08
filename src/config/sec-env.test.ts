import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecEnv } from "./sec-env.ts";

describe("SecEnv", () => {
  it("returns empty defaults with empty env", () => {
    const env = new SecEnv({ env: {} });
    assert.deepEqual(env.protocolFilter, []);
    assert.equal(env.proxyMode, false);
    assert.equal(env.proxyCreds, false);
    assert.equal(env.sssKeytab, undefined);
    assert.equal(env.krb5InitToken, false);
    assert.equal(env.username, undefined);
    assert.equal(env.password, undefined);
  });

  it("parses XrdSecPROTOCOL into protocolFilter", () => {
    const env = new SecEnv({
      env: { XrdSecPROTOCOL: "host, sss , gsi" },
    });
    assert.deepEqual(env.protocolFilter, ["host", "sss", "gsi"]);
  });

  it("parses XrdSecPROXY and XrdSecPROXYCREDS", () => {
    const env = new SecEnv({
      env: { XrdSecPROXY: "1", XrdSecPROXYCREDS: "1" },
    });
    assert.equal(env.proxyMode, true);
    assert.equal(env.proxyCreds, true);
  });

  it("treats XrdSecPROXY=0 as false", () => {
    const env = new SecEnv({
      env: { XrdSecPROXY: "0" },
    });
    assert.equal(env.proxyMode, false);
  });

  it("parses SSS keytab from XrdSecSSSKT", () => {
    const env = new SecEnv({
      env: { XrdSecSSSKT: "/etc/xrootd/sss.key" },
    });
    assert.equal(env.sssKeytab, "/etc/xrootd/sss.key");
  });

  it("falls back to XrdSecsssKT for SSS keytab", () => {
    const env = new SecEnv({
      env: { XrdSecsssKT: "/legacy/key.tab" },
    });
    assert.equal(env.sssKeytab, "/legacy/key.tab");
  });

  it("disables SSS when sss=false", () => {
    const env = new SecEnv({
      env: { XrdSecSSSKT: "/etc/xrootd/sss.key" },
      sss: false,
    });
    assert.equal(env.sssKeytab, undefined);
  });

  it("parses KRB5 init token", () => {
    const env = new SecEnv({
      env: { XrdSecKRB5INITTKN: "1" },
    });
    assert.equal(env.krb5InitToken, true);
  });

  it("disables KRB5 when krb5=false", () => {
    const env = new SecEnv({
      env: { XrdSecKRB5INITTKN: "1" },
      krb5: false,
    });
    assert.equal(env.krb5InitToken, false);
  });

  it("parses GSI variables with XrdSecGSI* prefix", () => {
    const env = new SecEnv({
      env: {
        XrdSecGSICADIR: "/custom/ca",
        XrdSecGSICRLDIR: "/custom/crl",
        XrdSecGSIUSERCERT: "/custom/cert.pem",
        XrdSecGSIUSERKEY: "/custom/key.pem",
        XrdSecGSIUSERPROXY: "/custom/proxy",
      },
    });
    assert.equal(env.gsiCaDir, "/custom/ca");
    assert.equal(env.gsiCrlDir, "/custom/crl");
    assert.equal(env.gsiUserCert, "/custom/cert.pem");
    assert.equal(env.gsiUserKey, "/custom/key.pem");
    assert.equal(env.gsiUserProxy, "/custom/proxy");
  });

  it("falls back to X509_* variables for GSI", () => {
    const env = new SecEnv({
      env: {
        X509_CERT_DIR: "/x509/ca",
        X509_USER_CERT: "/x509/cert.pem",
        X509_USER_KEY: "/x509/key.pem",
        X509_USER_PROXY: "/x509/proxy",
      },
    });
    assert.equal(env.gsiCaDir, "/x509/ca");
    assert.equal(env.gsiCrlDir, "/x509/ca");
    assert.equal(env.gsiUserCert, "/x509/cert.pem");
    assert.equal(env.gsiUserKey, "/x509/key.pem");
    assert.equal(env.gsiUserProxy, "/x509/proxy");
  });

  it("prefers XrdSecGSI* over X509_*", () => {
    const env = new SecEnv({
      env: {
        X509_CERT_DIR: "/x509/ca",
        XrdSecGSICADIR: "/gsi/ca",
      },
    });
    assert.equal(env.gsiCaDir, "/gsi/ca");
  });

  it("clears GSI fields when gsi=false", () => {
    const env = new SecEnv({
      env: { XrdSecGSICADIR: "/custom/ca" },
      gsi: false,
    });
    assert.equal(env.gsiCaDir, "");
    assert.equal(env.gsiCrlDir, "");
    assert.equal(env.gsiUserCert, "");
    assert.equal(env.gsiUserKey, "");
    assert.equal(env.gsiUserProxy, "");
  });

  it("parses PWD server public key", () => {
    const env = new SecEnv({
      env: { XrdSecPWDSRVPUK: "/etc/xrootd/pwdsrvpuk" },
    });
    assert.equal(env.pwdServerPubkey, "/etc/xrootd/pwdsrvpuk");
  });

  it("disables PWD when pwd=false", () => {
    const env = new SecEnv({
      env: { XrdSecPWDSRVPUK: "/etc/xrootd/pwdsrvpuk" },
      pwd: false,
    });
    assert.equal(env.pwdServerPubkey, undefined);
  });

  it("parses XrdSecUSER and XrdSecCREDS", () => {
    const env = new SecEnv({
      env: { XrdSecUSER: "admin", XrdSecCREDS: "secret123" },
    });
    assert.equal(env.username, "admin");
    assert.equal(env.password, "secret123");
  });

  it("protocolFilter overrides env-based parsing", () => {
    const env = new SecEnv({
      env: { XrdSecPROTOCOL: "host,sss" },
      protocolFilter: ["host"],
    });
    assert.deepEqual(env.protocolFilter, ["host"]);
  });

  it("fromEnv creates instance from process.env", () => {
    const env = SecEnv.fromEnv({ XrdSecPROTOCOL: "host" });
    assert.deepEqual(env.protocolFilter, ["host"]);
  });

  it("fromEnv accepts custom options", () => {
    const env = SecEnv.fromEnv(
      { XrdSecPROTOCOL: "host" },
      { gsi: false },
    );
    assert.deepEqual(env.protocolFilter, ["host"]);
    assert.equal(env.gsiCaDir, "");
  });

  describe("XrdSecPROTOCOL boundary cases", () => {
    it("empty string produces empty array", () => {
      const env = new SecEnv({ env: { XrdSecPROTOCOL: "" } });
      assert.deepEqual(env.protocolFilter, []);
    });

    it("trailing comma is filtered out", () => {
      const env = new SecEnv({ env: { XrdSecPROTOCOL: "host," } });
      assert.deepEqual(env.protocolFilter, ["host"]);
    });

    it("leading comma is filtered out", () => {
      const env = new SecEnv({ env: { XrdSecPROTOCOL: ",host" } });
      assert.deepEqual(env.protocolFilter, ["host"]);
    });

    it("single protocol", () => {
      const env = new SecEnv({ env: { XrdSecPROTOCOL: "gsi" } });
      assert.deepEqual(env.protocolFilter, ["gsi"]);
    });
  });

  describe("SSS priority", () => {
    it("XrdSecSSSKT takes priority over XrdSecsssKT", () => {
      const env = new SecEnv({
        env: {
          XrdSecSSSKT: "/primary/key",
          XrdSecsssKT: "/legacy/key",
        },
      });
      assert.equal(env.sssKeytab, "/primary/key");
    });
  });

  describe("all protocols disabled", () => {
    it("clears all protocol-specific fields", () => {
      const env = new SecEnv({
        env: {
          XrdSecSSSKT: "/etc/key",
          XrdSecKRB5INITTKN: "1",
          XrdSecGSICADIR: "/custom/ca",
          XrdSecPWDSRVPUK: "/custom/puk",
        },
        gsi: false,
        sss: false,
        krb5: false,
        pwd: false,
      });
      assert.equal(env.sssKeytab, undefined);
      assert.equal(env.krb5InitToken, false);
      assert.equal(env.gsiCaDir, "");
      assert.equal(env.pwdServerPubkey, undefined);
    });
  });

  describe("GSI default paths", () => {
    it("uses hardcoded defaults when no env vars set", () => {
      const env = new SecEnv({ env: {} });
      assert.equal(env.gsiCaDir, "/etc/grid-security/certificates");
      assert.equal(env.gsiCrlDir, "/etc/grid-security/certificates");
      assert.ok(env.gsiUserCert.includes(".globus/usercert.pem"));
      assert.ok(env.gsiUserKey.includes(".globus/userkey.pem"));
    });
  });
});
