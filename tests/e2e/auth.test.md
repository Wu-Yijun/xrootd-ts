# auth.test.ts — E2E Authentication Tests

Source: `tests/e2e/auth.test.ts`

Tests end-to-end authentication flows against real TCP servers. Covers host authentication success/failure and unsupported protocol scenarios. Uses `registerAuthProtocol()` to register real `HostAuth` and `SSSAuth` implementations.

Infrastructure: `createAuthServer(secReqs, authHandler)` creates a real TCP server that:
- Responds to `kXR_protocol` (3006) with ServerInitHandShake + protocol response.
- Responds to `kXR_login` (3007) with sessid[16] + secToken in `&P=<protocol>` format.
- Responds to `kXR_auth` (3000) by calling `authHandler(credType, credData)` and returning success or failure based on the result.

---

## E2E: host authentication

### 1. authenticates with host protocol — ✅ 保留

**Setup:** Server advertises `"host"` as the supported protocol. The `authHandler` asserts that `credType === 0` (host) and `credData` is non-empty, then returns `{ ok: true }`.

**Flow:**
1. Registers `HostAuth` via `registerAuthProtocol("host", () => new HostAuth())`.
2. Connects, creates multiplexer.
3. Calls `handshake(mux, url)` which performs:
   - ServerInitHandShake
   - kXR_protocol negotiation
   - kXR_login → receives sessid + secToken `"&P=host"`
   - Since `needsAuth === true`, calls `doAuthentication()` which selects the `"host"` protocol.
   - Sends `kXR_auth` with host credentials (hostname).
   - Server responds with success.

**Assertions:**
- `session` is defined with a valid sessid (16 bytes)
- `session.needsAuth === true`
- `session.authProtocols === ["host"]`
- Server-side `authHandler` received `credType === 0` and non-empty `credData`

**Operation:** Full authentication handshake with a real `HostAuth` implementation against a real TCP server.

### 2. auth failure sets needsAuth but does not throw — ✅ 保留

**Setup:** Server advertises `"host"` but the `authHandler` returns `{ ok: false, msg: "Host not trusted" }`, causing the server to respond with a 4003 error (errnum 3030).

**Flow:**
1. Registers `HostAuth`.
2. Connects, calls `handshake(mux, url)`.
3. Handshake completes — the session reflects the auth protocols from the secToken.

**Assertions:**
- `session.needsAuth === true`
- `session.authProtocols === ["host"]`
- No exception thrown during handshake (auth failure is recorded, not fatal at handshake level)

**Edge case:** When authentication fails, the handshake still completes and returns a session with `needsAuth === true`. The caller can decide how to handle the failed auth (e.g., prompt for different credentials).

## E2E: unsupported auth protocol

### 3. returns session with authProtocols when no supported protocol — ✅ 保留

**Setup:** Server advertises `"krb5"` as the supported protocol. The client does not register a `Krb5Auth` implementation (or it's not available).

**Flow:**
1. Connects, calls `handshake(mux, url)`.
2. Handshake completes — receives secToken `"&P=krb5"`.
3. Since no client-side `krb5` protocol is registered, `doAuthentication()` would fail, but the handshake returns the session with the auth info.

**Assertions:**
- `session.needsAuth === true`
- `session.authProtocols === ["krb5"]`

**Edge case:** When the server requires a protocol the client doesn't support, the session is still created with the auth protocol list. The caller can inspect `authProtocols` to determine which protocols are needed.

---

## 需要补充的测试

### A-1. SSS 认证 — 🔴 需要添加

注册 `SSSAuth`，服务器要求 `"sss"` 协议。验证完整的 SSS 认证流程：密钥派生、凭证发送、服务器验证。

### A-2. 多轮认证 (kXR_authmore) — 🔴 需要添加

服务器返回 4002 状态（"more data needed"），客户端发送 `kXR_authmore`，最终成功。`auth.ts:executeAuth` 循环处理此逻辑但无 E2E 测试。

### A-3. 多协议协商失败 — 🔴 需要添加

服务器提供多个协议（如 `"host,sss"`），但所有协议的认证都失败，验证客户端是否正确抛出 `AuthFailed` 错误。

### A-4. protocolFilter 选项 — 🔴 需要添加

使用 `protocolFilter: ["sss"]` 过滤，即使服务器提供 `"host,sss"`，客户端只尝试 SSS 认证。

### A-5. 无认证需求 (needsAuth=false) — 🔴 需要添加

服务器 login 响应中 secToken 不包含 `&P=`，验证 `session.needsAuth === false` 且不发送 kXR_auth。

### A-6. 带 username 的握手 — 🔴 需要添加

`handshake(mux, url, { username: "alice" })` 传入用户名，验证 server 收到正确的 XrdSecUSER。

### A-7. login 重定向期间握手 — 🔴 需要添加

`handshake.ts` 处理 `ResponseStatus.Redirect`，但无 E2E 测试验证在握手期间收到 4004 重定向时的行为。
