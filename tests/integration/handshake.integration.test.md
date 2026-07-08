# handshake.integration.test.ts — Handshake Integration Tests

Source: `tests/integration/handshake.integration.test.ts`

Tests the XRootD connection handshake against a real XRootD server. Validates that the handshake produces a valid session with correct sessid and protocol version, and that `XRootDClient.connect()` completes the full handshake automatically. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection to `XROOTD_HOST:XROOTD_PORT` (default `localhost:1094`). Each test uses a 5-second timeout.

---

## 1. handshake() returns Session with valid sessid and protocolVersion — ✅ 保留

**Flow:**
1. Creates `Transport`, connects to the real server.
2. Creates `Multiplexer`.
3. Calls `handshake(mux, url)` with a 5-second timeout.

**Assertions:**
- `session` is defined
- `session.sessid` is defined and has length 16
- `session.protocolVersion > 0`

**Operation:** Happy path — the handshake function successfully negotiates with a real XRootD server and produces a valid session.

## 2. handshake() with username returns valid Session — ✅ 保留

**Flow:**
1. Creates `Transport`, connects to the real server.
2. Calls `handshake(mux, url, { username: "testuser", pid: 12345 })`.

**Assertions:**
- `session.sessid.length === 16`
- `session.protocolVersion > 0`

**Edge case:** Handshake with explicit username and PID parameters. Validates that the login request correctly includes the provided credentials.

## 3. XRootDClient.connect() completes full handshake — ✅ 保留

**Flow:**
1. Creates `XRootDClient` with the server URL.
2. Calls `client.connect()` with a 5-second timeout.

**Assertions:**
- `client.isConnected === true`

**Operation:** The high-level `XRootDClient` API completes the full handshake (protocol + login) and reports as connected.

---

## 需要补充的测试

### IH-1. handshake 超时 — 🔴 需要添加

使用不可达的 IP 地址和短超时（如 100ms），验证 handshake 正确超时并抛出错误。

### IH-2. handshake 协议版本验证 — 🟡 需要添加

验证 `session.protocolVersion` 等于 `PROTOCOL_VERSION (0x520)`。

### IH-3. handshake 多次调用 — 🟡 需要添加

在同一 mux 上多次调用 `handshake()`，验证每次返回有效的 session（幂等性）。

### IH-4. XRootDClient 重连 — 🔴 需要添加

`client.close()` 后再 `client.connect()`，验证可以重新建立连接。

### IH-5. handshake 带 password — 🟡 需要添加

`handshake(mux, url, { username: "user", password: "pass" })` 传入密码，验证服务器收到。

### IH-6. handshake 错误处理 — 🟡 需要添加

连接到一个非 XRootD 服务器（如随机端口），验证 handshake 正确处理协议错误。
