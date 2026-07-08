import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { XRootDUrl } from "./url.ts";

describe("XRootDUrl", () => {
  it("parses full URL with host:port/path", () => {
    const url = new XRootDUrl("root://host.cern.ch:1095/data");
    assert.equal(url.protocol, "root");
    assert.equal(url.host, "host.cern.ch");
    assert.equal(url.port, 1095);
    assert.equal(url.path, "/data");
  });

  it("uses default port 1094 when omitted", () => {
    const url = new XRootDUrl("root://host.cern.ch/data");
    assert.equal(url.port, 1094);
  });

  it("parses roots:// secure protocol", () => {
    const url = new XRootDUrl("roots://host.cern.ch/data");
    assert.equal(url.protocol, "roots");
    assert.equal(url.isSecure(), true);
  });

  it("parses user:pass@host:port/path", () => {
    const url = new XRootDUrl("root://alice:secret@host.cern.ch:1095/data");
    assert.equal(url.user, "alice");
    assert.equal(url.password, "secret");
    assert.equal(url.host, "host.cern.ch");
    assert.equal(url.port, 1095);
    assert.equal(url.path, "/data");
  });

  it("throws on malformed URL", () => {
    assert.throws(() => new XRootDUrl("root://host:abc/port"));
  });

  it("isValid() returns true for root and roots", () => {
    assert.equal(new XRootDUrl("root://h/p").isValid(), true);
    assert.equal(new XRootDUrl("roots://h/p").isValid(), true);
  });

  it("isSecure() returns true only for roots", () => {
    assert.equal(new XRootDUrl("root://h/p").isSecure(), false);
    assert.equal(new XRootDUrl("roots://h/p").isSecure(), true);
  });

  it("getHostId() includes user:pass@host:port", () => {
    const url = new XRootDUrl("root://alice:s3cr3t@host.cern.ch:1095/data");
    assert.equal(url.getHostId(), "alice:s3cr3t@host.cern.ch:1095");
  });

  it("getHostId() without auth", () => {
    const url = new XRootDUrl("root://host.cern.ch/data");
    assert.equal(url.getHostId(), "host.cern.ch:1094");
  });

  it("getChannelId() is host:port", () => {
    const url = new XRootDUrl("root://host.cern.ch:1095/data");
    assert.equal(url.getChannelId(), "host.cern.ch:1095");
  });

  it("getLocation() is protocol://host:port/path", () => {
    const url = new XRootDUrl("root://host.cern.ch:1095/data");
    assert.equal(url.getLocation(), "root://host.cern.ch:1095/data");
  });

  it("toString() round-trips", () => {
    const url = new XRootDUrl("root://alice:pw@host.cern.ch:1095/data");
    const str = url.toString();
    assert.equal(str, "root://alice:pw@host.cern.ch:1095/data");
  });

  it("toString() omits default port", () => {
    const url = new XRootDUrl("root://host.cern.ch/data");
    assert.equal(url.toString(), "root://host.cern.ch/data");
  });

  it("static parse() creates instance", () => {
    const url = XRootDUrl.parse("root://host/path");
    assert.ok(url instanceof XRootDUrl);
    assert.equal(url.host, "host");
  });

  it("parses URL without path", () => {
    const url = new XRootDUrl("root://host.cern.ch");
    assert.equal(url.path, "/");
  });

  it("auto-adds root:// prefix when missing", () => {
    const url = XRootDUrl.parse("host/path");
    assert.equal(url.protocol, "root");
    assert.equal(url.host, "host");
    assert.equal(url.path, "/path");
  });

  it("parses user@host without password", () => {
    const url = new XRootDUrl("root://alice@host/path");
    assert.equal(url.user, "alice");
    assert.equal(url.password, undefined);
  });

  it("roots:// serialization preserves secure prefix", () => {
    const url = new XRootDUrl("roots://host/path");
    const str = url.toString();
    assert.ok(str.startsWith("roots://"));
    assert.equal(str, "roots://host/path");
  });

  it("getLocation() and toString() are consistent without credentials", () => {
    const url = new XRootDUrl("root://host.cern.ch:1095/data");
    assert.equal(url.getLocation(), url.toString());
  });

  it("getLocation() and toString() are consistent with credentials", () => {
    const url = new XRootDUrl("root://alice:pw@host.cern.ch:1095/data");
    // getLocation() does NOT include credentials, toString() does
    assert.equal(url.getLocation(), "root://host.cern.ch:1095/data");
    assert.equal(url.toString(), "root://alice:pw@host.cern.ch:1095/data");
  });

  it("port 0 is accepted", () => {
    const url = new XRootDUrl("root://host:0/path");
    assert.equal(url.port, 0);
  });

  it("port 65535 (max legal) is accepted", () => {
    const url = new XRootDUrl("root://host:65535/path");
    assert.equal(url.port, 65535);
  });

  it("parses URL with empty path component", () => {
    const url = new XRootDUrl("root://host:1095");
    assert.equal(url.path, "/");
  });
});
