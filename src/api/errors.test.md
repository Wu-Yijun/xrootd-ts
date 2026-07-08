# errors.test.ts — XRootDError Unit Tests

Source: `src/api/errors.test.ts`

Module under test: `XRootDError` — Custom error class for XRootD protocol errors. Contains an error code, optional errno, and a human-readable message derived from a known error code mapping.

---

## 1. sets code and message from constructor

Constructs `new XRootDError(3011, "File not found")`. Asserts:
- `err.code === 3011`
- `err.message === "File not found"`
- `err.name === "XRootDError"`
- `err instanceof Error === true`

**Operation:** Basic construction with explicit code and message.

## 2. uses codeToMessage when no message provided

Constructs `new XRootDError(3011)` without a message. Asserts `err.message === "File not found"` (auto-resolved from the code).

**Edge case:** When no message is provided, the static `codeToMessage` lookup provides the default message.

## 3. sets errno when provided

Constructs `new XRootDError(3005, "FS error", 2)`. Asserts `err.errno === 2`.

**Operation:** Optional `errno` field for underlying system error codes.

## 4. errno is undefined when not provided

Constructs `new XRootDError(3011)`. Asserts `err.errno === undefined`.

**Edge case:** When no errno is provided, the field is absent (not null or 0).

## 5. codeToMessage returns correct messages for known codes

Asserts `XRootDError.codeToMessage()` returns correct messages for these known XRootD error codes:
- `3000` → "Invalid argument"
- `3001` → "Missing argument"
- `3003` → "File locked"
- `3004` → "File not open"
- `3007` → "I/O error"
- `3010` → "Not authorized"
- `3011` → "File not found"
- `3012` → "Server error"
- `3016` → "Is a directory"
- `3018` → "File already exists"
- `3028` → "TLS required"
- `3030` → "Authentication failed"
- `3035` → "Timer expired"

**Operation:** Static error code to message mapping for all known codes.

## 6. unknown code returns default message

Asserts `XRootDError.codeToMessage(9999)` returns `"Unknown error (9999)"`.

**Edge case:** Unrecognized error codes produce a generic message that includes the code number.

## 7. known ClientError codes have messages

Asserts `XRootDError.codeToMessage(0)` returns `"OK"`.

**Edge case:** The success code (0) is also mapped to a human-readable message.
