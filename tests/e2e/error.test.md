# error.test.ts — E2E Error Handling Tests

Source: `tests/e2e/error.test.ts`

Tests error propagation in real TCP scenarios: server-side protocol errors, connection drops, and request timeouts. Uses real TCP servers that simulate various failure modes.

---

## 1. kXR_error throws XRootDError — ✅ 保留

**Setup:** A real TCP server responds to:
- `kXR_protocol` (3006) → success
- `kXR_login` (3007) → success (16-byte sessid)
- `kXR_open` (3010) → 4003 error with errnum 3011 ("No such file")

**Flow:**
1. Connects, sends protocol and login manually.
2. Creates a `File` and attempts to open `/nonexistent/file.txt`.
3. The server responds with a `4003` error frame containing errnum 3011.

**Assertions:**
- The promise rejects with an `XRootDError` instance
- `err.code === 3011`
- `err.message` matches `/no such file/i`

**Operation:** Verifies that server-side kXR_error responses are properly propagated as typed `XRootDError` objects through the full stack (Transport → Multiplexer → File).

## 2. connection disconnect rejects pending request — ✅ 保留

**Setup:** A real TCP server responds normally to protocol, login, and open requests, but **destroys the socket** when it receives a `kXR_read` (3013) request.

**Flow:**
1. Connects, performs protocol + login, opens a file.
2. Calls `file.read(0, 100)` — the server receives the read request and immediately calls `socket.destroy()`.
3. The read promise should reject because the connection was severed.

**Assertions:**
- The promise rejects with an `Error` instance

**Edge case:** When the server abruptly closes the connection mid-operation, the multiplexer must reject the pending request rather than hanging forever.

## 3. timeout rejects pending request — ✅ 保留

**Setup:** A real TCP server responds to protocol and login but **never responds** to any other request (e.g., `kXR_read`). The server simply ignores the request.

**Flow:**
1. Connects, performs protocol + login.
2. Sets `mux.setTimeout(100)` (100ms timeout).
3. Sends a `kXR_read` (3013) request that the server will never answer.

**Assertions:**
- The promise rejects with an error matching `/timeout/`

**Edge case:** When the server silently drops a request, the multiplexer's timeout mechanism must eventually reject the pending request.

---

## 需要补充的测试

### E-1. kXR_wait (4005) 重试 — 🔴 需要添加

服务器返回 4005（"busy, retry after N seconds"）状态。Multiplexer `multiplexer.ts:155-160` 处理此状态并设置 `retryAfter`。E2E 测试应验证客户端收到 4005 后自动重试并最终成功。

### E-2. 多种错误码 — 🔴 需要添加

目前只测试 errnum 3011。应测试：
- 3000 (ArgInvalid) — 参数无效
- 3003 (FileLocked) — 文件被锁定
- 3010 (NotAuthorized) — 未授权
- 3013 (Unsupported) — 不支持的操作
- 3016 (IsDirectory) — 路径是目录

### E-3. kXR_waitresp (4006) 异步等待 — 🔴 需要添加

服务器返回 4006（"processing, wait for async result"）。Multiplexer `multiplexer.ts:162-166` 设置 `shouldRetry=false` 并等待异步响应。需要 E2E 测试验证此流程。

### E-4. kXR_attn 异步响应 — 🔴 需要添加

服务器发送 4001 + action 5008（嵌入响应）。Multiplexer 处理此逻辑但无 E2E 测试。

### E-5. 错误码 3018 (ItExists) — 🔴 需要添加

测试 open 一个已存在的 exclusive 创建文件时的错误。

### E-6. 错误响应体截断 — 🔴 需要添加

服务器发送的错误帧 body 长度不足（如缺少 errtext 部分），验证客户端不会崩溃。
