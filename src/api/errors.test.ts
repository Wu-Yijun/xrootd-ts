import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { XRootDError, assertOkFrame } from "./errors.ts";
import { ResponseStatus } from "../protocol/constants.ts";
import type { Frame } from "../transport/framer.ts";

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

  it("errno=0 is preserved (not undefined)", () => {
    const err = new XRootDError(3011, "msg", 0);
    assert.equal(err.errno, 0);
  });

  it("codeToMessage returns correct messages for known codes", () => {
    assert.equal(XRootDError.codeToMessage(3000), "Invalid argument");
    assert.equal(XRootDError.codeToMessage(3001), "Missing argument");
    assert.equal(XRootDError.codeToMessage(3002), "Argument too long");
    assert.equal(XRootDError.codeToMessage(3003), "File locked");
    assert.equal(XRootDError.codeToMessage(3004), "File not open");
    assert.equal(XRootDError.codeToMessage(3005), "File system error");
    assert.equal(XRootDError.codeToMessage(3006), "Invalid request");
    assert.equal(XRootDError.codeToMessage(3007), "I/O error");
    assert.equal(XRootDError.codeToMessage(3008), "No memory");
    assert.equal(XRootDError.codeToMessage(3009), "No space");
    assert.equal(XRootDError.codeToMessage(3010), "Not authorized");
    assert.equal(XRootDError.codeToMessage(3011), "File not found");
    assert.equal(XRootDError.codeToMessage(3012), "Server error");
    assert.equal(XRootDError.codeToMessage(3013), "Unsupported");
    assert.equal(XRootDError.codeToMessage(3014), "No server");
    assert.equal(XRootDError.codeToMessage(3015), "Not a file");
    assert.equal(XRootDError.codeToMessage(3016), "Is a directory");
    assert.equal(XRootDError.codeToMessage(3017), "Operation cancelled");
    assert.equal(XRootDError.codeToMessage(3018), "File already exists");
    assert.equal(XRootDError.codeToMessage(3019), "Checksum error");
    assert.equal(XRootDError.codeToMessage(3028), "TLS required");
    assert.equal(XRootDError.codeToMessage(3030), "Authentication failed");
    assert.equal(XRootDError.codeToMessage(3035), "Timer expired");
  });

  it("ClientError codes have messages", () => {
    assert.equal(XRootDError.codeToMessage(0), "OK");
    assert.equal(XRootDError.codeToMessage(300), "Invalid arguments");
    assert.equal(XRootDError.codeToMessage(301), "Not found");
    assert.equal(XRootDError.codeToMessage(302), "Permission denied");
    assert.equal(XRootDError.codeToMessage(307), "Internal error");
    assert.equal(XRootDError.codeToMessage(309), "Timeout");
    assert.equal(XRootDError.codeToMessage(311), "Client not connected");
    assert.equal(XRootDError.codeToMessage(312), "Disconnected");
    assert.equal(XRootDError.codeToMessage(313), "Redirect");
    assert.equal(XRootDError.codeToMessage(315), "Too many redirects");
  });

  it("unknown code returns default message", () => {
    assert.equal(XRootDError.codeToMessage(9999), "Unknown error (9999)");
  });

  it("negative code returns default message", () => {
    assert.equal(XRootDError.codeToMessage(-1), "Unknown error (-1)");
  });
});

describe("assertOkFrame", () => {
  function makeFrame(status: number, body: Buffer): Frame {
    return { streamId: 1, status, dlen: body.length, body };
  }

  it("does not throw for status=0 (kXR_ok)", () => {
    const frame = makeFrame(ResponseStatus.Ok, Buffer.alloc(0));
    assert.doesNotThrow(() => assertOkFrame(frame));
  });

  it("does not throw for status=4000 (kXR_oksofar)", () => {
    const frame = makeFrame(ResponseStatus.Oksofar, Buffer.from([1, 2, 3]));
    assert.doesNotThrow(() => assertOkFrame(frame));
  });

  it("throws XRootDError for status=4003 (kXR_error)", () => {
    const errMsg = "not found";
    const body = Buffer.alloc(4 + errMsg.length + 1);
    body.writeUInt32BE(3011, 0);
    Buffer.from(errMsg, "utf8").copy(body, 4);
    body[4 + errMsg.length] = 0;
    const frame = makeFrame(ResponseStatus.Error, body);

    assert.throws(
      () => assertOkFrame(frame),
      (err: any) => err instanceof XRootDError && err.code === 3011,
    );
  });
});
