# E2E Test Fix Analysis

## Test Results Summary

| File | Status | Root Cause |
|------|--------|------------|
| auth.test.ts | PASS | — |
| client-redirect.test.ts | PASS | — |
| filesystem.test.ts | FAIL (2/5) | Test script error |
| read.test.ts | TIMEOUT | Test script error |
| error.test.ts | TIMEOUT | Test script error |
| redirect.test.ts | FAIL + TIMEOUT | Test script error |

---

## Issue 1: filesystem.test.ts — `this.getMux is not a function`

**Type**: Test script error

**Error**:
```
TypeError: this.getMux is not a function
    at FileSystem.mkdir (src/api/filesystem.ts:46:42)
```

**Analysis**: `FileSystem` constructor signature is `constructor(getMux: () => Multiplexer)` — it expects a **getter function** that returns a `Multiplexer`. The test at `filesystem.test.ts:255` passes the mux directly:
```ts
const fs = new FileSystem(mux);  // BUG: should be () => mux
```

This causes `this.getMux` to be the Multiplexer object itself, not a function. When `mkdir()` calls `this.getMux()`, it throws because the object is not callable.

**Fix**: Change `new FileSystem(mux)` to `new FileSystem(() => mux)` in `setupSession()`.

---

## Issue 2: read.test.ts — Hangs (timeout)

**Type**: Test script error

**Analysis**: The `File` class was refactored from `File(mux: Multiplexer, session: Session)` to `File(options: FileConnectionOptions)`. The old constructor accepted pre-established mux/session directly. The new constructor only accepts connection options (url, credentials, etc.) and manages its own connection lifecycle internally.

The test at `read.test.ts:145` uses the old API:
```ts
const file = new File(mux, session);
await file.open("/data/test.txt", { flags: 0x0010 });
```

Since `File` now only takes one argument, `mux` is treated as `FileConnectionOptions`, and `session` is silently ignored. When `open()` is called, `this.mux` is null (never set), so it tries `connectToHost(this.options.url)` where `this.options.url` is undefined (mux has no `url` property) → TypeError or hang.

**Fix**: Replace `File` usage with direct `sendRequest()` + protocol builders (`buildOpenRequest`, `buildReadRequest`, `buildCloseRequest`), since the test already establishes transport/mux manually.

---

## Issue 3: error.test.ts — Hangs (timeout)

**Type**: Test script error

**Analysis**: Same root cause as read.test.ts. Tests 1 and 2 use `new File(mux, session)` with the old API. The first test hangs at the `file.open()` call because `File` tries to connect internally with undefined options.

Test 3 (timeout test) doesn't use `File` and would work correctly, but it never runs because the first test hangs and the test runner eventually gives up.

**Fix**: Replace `File` usage in tests 1 and 2 with direct `sendRequest()` + protocol builders.

---

## Issue 4: redirect.test.ts — Fails + hangs

**Type**: Test script error

**Analysis**: Same root cause. After successful redirect from server A to server B, the test creates:
```ts
const file = new File(mux2!, session);
await file.open("/data/test.txt", { flags: 0x0010 });
```
This uses the old `File(mux, session)` API. The `File` class no longer accepts this signature.

**Fix**: Replace `File` usage with direct `sendRequest()` + protocol builders.

---

## Fix Strategy

All 3 hanging/failing tests (read, error, redirect) need the same pattern:
1. Remove `File` import and usage
2. Import `sendRequest` from `src/utils/request.ts`
3. Import `buildOpenRequest`, `buildReadRequest`, `buildCloseRequest` from `src/protocol/message.ts`
4. Import `parseOpenResponse` from `src/protocol/message.ts` (to extract fhandle)
5. Replace `file.open()` → `sendRequest(mux, buildOpenRequest(...))` + `parseOpenResponse()`
6. Replace `file.read()` → `sendRequest(mux, buildReadRequest(...))`
7. Replace `file.close()` → `sendRequest(mux, buildCloseRequest(...))`

The `filesystem.test.ts` fix is a one-line change: `new FileSystem(mux)` → `new FileSystem(() => mux)`.
