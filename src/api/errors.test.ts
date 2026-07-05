import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { XRootDError } from "./errors.ts";

describe("XRootDError", () => {
  it("sets code and message from constructor", () => {
    const err = new XRootDError(3011, "File not found");
    assert.equal(err.code, 3011);
    assert.equal(err.message, "File not found");
    assert.equal(err.name, "XRootDError");
    assert.ok(err instanceof Error);
  });

  it("uses codeToMessage when no message provided", () => {
    const err = new XRootDError(3011);
    assert.equal(err.message, "File not found");
  });

  it("sets errno when provided", () => {
    const err = new XRootDError(3005, "FS error", 2);
    assert.equal(err.errno, 2);
  });

  it("errno is undefined when not provided", () => {
    const err = new XRootDError(3011);
    assert.equal(err.errno, undefined);
  });

  it("codeToMessage returns correct messages for known codes", () => {
    assert.equal(XRootDError.codeToMessage(3000), "Invalid argument");
    assert.equal(XRootDError.codeToMessage(3001), "Missing argument");
    assert.equal(XRootDError.codeToMessage(3003), "File locked");
    assert.equal(XRootDError.codeToMessage(3004), "File not open");
    assert.equal(XRootDError.codeToMessage(3007), "I/O error");
    assert.equal(XRootDError.codeToMessage(3010), "Not authorized");
    assert.equal(XRootDError.codeToMessage(3011), "File not found");
    assert.equal(XRootDError.codeToMessage(3012), "Server error");
    assert.equal(XRootDError.codeToMessage(3016), "Is a directory");
    assert.equal(XRootDError.codeToMessage(3018), "File already exists");
    assert.equal(XRootDError.codeToMessage(3028), "TLS required");
    assert.equal(XRootDError.codeToMessage(3030), "Authentication failed");
    assert.equal(XRootDError.codeToMessage(3035), "Timer expired");
  });

  it("unknown code returns default message", () => {
    assert.equal(XRootDError.codeToMessage(9999), "Unknown error (9999)");
    assert.equal(XRootDError.codeToMessage(0), "Unknown error (0)");
  });
});
