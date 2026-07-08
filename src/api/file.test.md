# file.test.ts — File Unit Tests

Source: `src/api/file.test.ts`

Module under test: `File` — XRootD file handle abstraction providing open/read/write/close/sync/truncate operations. Manages file lifecycle and enforces state (open vs closed).

Helper: `MockTransport` uses a response queue to automatically respond to each request with pre-configured frames.

---

## 1. open() sends correct request and stores fhandle — ✅ 保留

Creates a file, enqueues an open response with `fhandle = [0xaa, 0xbb, 0xcc, 0xdd]`. Calls `file.open("/data/test.txt", { flags: 0x0010 })`. Asserts:
- `file.isOpen === true`
- At least one request was sent to the transport
- The request is a kXR_open (3010) request

Then closes the file and mux.

**Operation:** Happy path — file open sends a request and stores the returned file handle.

## 2. read() sends correct request with fhandle + offset + size — ✅ 保留

Opens a file with a known fhandle, enqueues a data response `[0xde, 0xad, 0xbe, 0xef]`. Calls `file.read(1024, 4096)`. Asserts:
- Returned data matches `[0xde, 0xad, 0xbe, 0xef]`
- The last sent request has `requestid = 3013` (kXR_read)

Then closes the file and mux.

**Operation:** Read request encodes offset and size, response data is returned.

## 3. write() sends correct request — ✅ 保留

Opens a file with a known fhandle, enqueues a success response. Calls `file.write(0, [1,2,3,4,5])`. Asserts:
- Returned `written === 5`
- The last sent request has `requestid = 3019` (kXR_write)

Then closes the file and mux.

**Operation:** Write request sends data and returns the number of bytes written.

## 4. close() sends close request and clears state — ✅ 保留

Opens a file, asserts `file.isOpen === true`. Calls `file.close()`, asserts `file.isOpen === false`.

**Operation:** Close sends a kXR_close request and resets the file's open state.

## 5. operations on closed file throw XRootDError — ✅ 保留

Attempts `file.read(0, 100)` and `file.write(0, [1])` on a file that was never opened. Asserts both reject with `XRootDError` having `code === 3004` (File not open).

**Edge case:** Read/write on a closed file must fail with the appropriate error code.

## 6. open on already-open file throws — ✅ 保留

Opens a file, then attempts `file.open("/other", ...)`. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Cannot open a file that is already open — must close first.

## 7. open error throws XRootDError — ✅ 保留

Enqueues an error response (`4003` / errnum 3011 "not found"). Attempts `file.open("/nonexistent", ...)`. Asserts rejection with `XRootDError` code `3011`.

**Error case:** Server-side open failure is propagated as `XRootDError`.

## 8. sync() sends sync request — ✅ 保留

Opens a file, calls `file.sync()`. Asserts the last sent request has `requestid = 3016` (kXR_sync).

**Operation:** Sync sends a kXR_sync request to flush data to the server.

## 9. sync() on closed file throws — ✅ 保留

Attempts `file.sync()` on a never-opened file. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Sync on a closed file must fail.

## 10. truncate() sends truncate request — ✅ 保留

Opens a file, calls `file.truncate(1024)`. Asserts the last sent request has `requestid = 3028` (kXR_truncate).

**Operation:** Truncate sends a kXR_truncate request with the target size.

## 11. truncate() on closed file throws — ✅ 保留

Attempts `file.truncate(0)` on a never-opened file. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Truncate on a closed file must fail.

---

## 需要补充的测试

### F-1. stat() 方法 — 🔴 需要添加

`file.ts:260-287` 中的 `stat()` 方法完全未测试。测试用例：
- 打开文件后调用 `file.stat()`，模拟 stat 响应 `"12345 1024 0 1700000000 1700000001 1700000002 100644 root root"`。验证返回 `StatInfo` 对象，`size === 1024n`，`isDirectory === false`。
- `stat()` 对已关闭文件抛出 3004。

### F-2. read() 返回 Oksofar 状态 — 🟡 需要添加

`file.ts:188-191` 处理 `ResponseStatus.Ok` 和 `ResponseStatus.Oksofar`。模拟 `status=4000`（Oksofar）的响应，验证数据仍被正确返回。

### F-3. write() 返回 dlen > 0 — 🟡 需要添加

`file.ts:221` — `return frame.dlen > 0 ? frame.dlen : data.length`。模拟 `dlen=10` 的响应，验证返回值为 10 而非 data.length。

### F-4. close() 有 pendingOperations 时抛出 — 🟡 需要添加

`file.ts:238-241` — 当 `pendingOperations > 0` 时调用 `close()` 应抛出 `ClientError.InternalError`。验证此安全守卫。

### F-5. close() 的幂等性 — 🟡 需要添加

`file.ts:234-236` — `if (this.isClosed) return;`。验证连续调用两次 `close()` 不抛出异常。

### F-6. read/write/stat 在 close() 之后的状态区分

`file.ts:173-174` 检查 `isClosed`，`file.ts:177-179` 检查 `_isOpen`。验证：
- 从未 open 过的 file → `read()` 抛出 "File is not open"
- open 后 close 的 file → `read()` 抛出 "File is closed"

### F-7. handleRedirect() 重定向处理

`file.ts:102-157` — 重定向逻辑包含 URL 解析、opaque query 处理、重新连接。验证：
- 重定向到新 host:port 后成功重试请求
- 带 opaque query 的重定向（如 `host?opaque=path`）
- 重定向到不可达服务器时的错误传播

### F-8. cleanup() 清理逻辑

验证 `cleanup()` 正确关闭 mux 和 transport，重置 fhandle 和 _isOpen。
