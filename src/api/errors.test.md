# errors.test.ts — XRootDError Unit Tests

Source: `src/api/errors.test.ts`

Module under test: `XRootDError` — Custom error class for XRootD protocol errors. Contains an error code, optional errno, and a human-readable message derived from a known error code mapping. Also exports `assertOkFrame()` for checking response frames.

---

## 1. sets code and message from constructor — ✅ 保留

Constructs `new XRootDError(3011, "File not found")`. Asserts:
- `err.code === 3011`
- `err.message === "File not found"`
- `err.name === "XRootDError"`
- `err instanceof Error === true`

**Operation:** Basic construction with explicit code and message.

## 2. uses codeToMessage when no message provided — ✅ 保留

Constructs `new XRootDError(3011)` without a message. Asserts `err.message === "File not found"` (auto-resolved from the code).

**Edge case:** When no message is provided, the static `codeToMessage` lookup provides the default message.

## 3. sets errno when provided — ✅ 保留

Constructs `new XRootDError(3005, "FS error", 2)`. Asserts `err.errno === 2`.

**Operation:** Optional `errno` field for underlying system error codes.

## 4. errno is undefined when not provided — ✅ 保留

Constructs `new XRootDError(3011)`. Asserts `err.errno === undefined`.

**Edge case:** When no errno is provided, the field is absent (not null or 0).

## 5. codeToMessage returns correct messages for known codes — ✅ 保留

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

## 6. unknown code returns default message — ✅ 保留

Asserts `XRootDError.codeToMessage(9999)` returns `"Unknown error (9999)"`.

**Edge case:** Unrecognized error codes produce a generic message that includes the code number.

## 7. known ClientError codes have messages — ✅ 保留

Asserts `XRootDError.codeToMessage(0)` returns `"OK"`.

**Edge case:** The success code (0) is also mapped to a human-readable message.

---

## 需要补充的测试

### E-1. assertOkFrame 正常帧不抛出 — 🔴 需要添加

`errors.ts:93-97` 中的 `assertOkFrame()` 完全未测试。验证：
- 传入 `status=0`（kXR_ok）的 frame → 不抛出
- 传入 `status=4000`（kXR_oksofar）的 frame → 不抛出

### E-2. assertOkFrame 错误帧抛出 — 🔴 需要添加

- 传入 `status=4003`（kXR_error）的 frame，body 包含 `errnum=3011` + `"not found\0"` → 抛出 `XRootDError`，`code=3011`，`message` 包含 `"not found"`

### E-3. codeToMessage 补充覆盖

当前仅测试了 13 个 ServerError 码和 1 个 ClientError 码。建议补充：
- `3002` → "Argument too long" (ArgTooLong)
- `3005` → "File system error" (FSError)
- `3006` → "Invalid request" (InvalidRequest)
- `3008` → "No memory" (NoMemory)
- `3009` → "No space" (NoSpace)
- `3013` → "Unsupported" (Unsupported)
- `3014` → "No server" (NoServer)
- `3015` → "Not a file" (NotFile)
- `3017` → "Operation cancelled" (Cancelled)
- `3019` → "Checksum error" (CheckSumErr)
- ClientError 码：`101`-`315` 等

### E-4. errno = 0 的行为

构造 `new XRootDError(3011, "msg", 0)`，验证 `errno === 0`（而非 `undefined`，因为 `0` 是 falsy 但显式传入）。

### E-5. 负数错误码

传入负数错误码，验证 `codeToMessage` 返回 `"Unknown error (-1)"`。
