# handshake.test.ts — Handshake Unit Tests

Source: `src/session/handshake.test.ts`

Module under test: `handshake()` — Performs the XRootD connection handshake sequence: sends ClientInitHandShake + kXR_protocol request, receives ServerInitHandShake + protocol response, then sends kXR_login and receives sessid. Returns a `Session` object with protocol version, session ID, and authentication info.

Helper: `MockTransportForHandshake` simulates the transport layer, allowing tests to emit specific response frames.

---

## 1. returns Session with correct sessid and protocolVersion — ✅ 保留

Simulates the full three-step handshake:
1. Sends `ServerInitHandShake` frame (protover=0x520, msgval=1)
2. Sends `kXR_ok` + protocol response (pval=0x520, flags=0x09)
3. Sends `kXR_ok` + login response with sessid bytes [1..16]

Asserts the resolved `Session` has:
- `protocolVersion === 0x520`
- `needsAuth === false` (no secToken in login response)
- `authProtocols === undefined`
- `sessid` is `[1, 2, ..., 16]`

**Operation:** Happy path — complete handshake produces a valid session.

## 2. sends correct handshake + protocol in first send — ✅ 保留

Simulates the same three-step handshake but inspects the **data sent** by the client. Asserts the first send is exactly 44 bytes (20-byte ClientInitHandShake + 24-byte kXR_protocol request) and verifies:
- Handshake constants: `first=0, second=0, third=0, fourth=4, fifth=2012`
- Protocol request fields: `requestid=3006` (kXR_protocol), `clientpv=0x520`

**Operation:** Validates the exact binary format of the initial handshake + protocol request message.

## 3. sends login request as second send — ✅ 保留

Simulates the handshake and inspects the second `send()` call. Asserts:
- `requestid = 3007` (kXR_login)
- `pid = 42`
- `username` field contains `"alice"` (padded to 8 bytes)

**Operation:** Validates the binary layout of the kXR_login request, including pid, username, and reserved fields.

## 4. returns authProtocols from login secToken — ✅ 保留

Simulates the handshake with a login response that includes a `secToken` of `"&P=host&P=sss"`. Asserts:
- `needsAuth === true` (secToken present)
- `authProtocols === ["host", "sss"]`

**Edge case:** The secToken is a query-string-like format where `&P=<protocol>` entries list the server's supported authentication protocols.

## 5. throws on protocol error response — ✅ 保留

Simulates the handshake but returns an error frame (`4003` / errnum 3006, message "protocol not supported") instead of the protocol response. Asserts the session promise is rejected with a message containing "Protocol handshake error".

**Error case:** Server does not support the requested protocol version.

## 6. throws on login error response — ✅ 保留

Simulates the handshake through the protocol step, then returns an error frame (`4003` / errnum 3010, "not authorized") for the login request. Asserts the session promise is rejected with a message containing "Login error".

**Error case:** Server rejects the login attempt (e.g., unauthorized).

## 7. throws on login redirect response — ✅ 保留

Simulates the handshake through the protocol step, then returns a redirect response (`4004` / port=1095, host="other.server.com") for the login request. Asserts the session promise is rejected with a message containing "redirect".

**Error case:** Server responds to login with a redirect to another server. The handshake does not follow redirects — it rejects.

---

## 需要补充的测试

### H-1. 默认 username 和 pid

`handshake.ts:59-60` 中 `username = options?.username ?? ""` 和 `pid = options?.pid ?? process.pid`。验证不传 `options` 时：
- `username` 为空字符串
- `pid` 为 `process.pid`

### H-2. seclvl 和 bifReqs 字段

`handshake.ts:139-140` 将 `protoResp.seclvl` 和 `protoResp.bifReqs` 传入 Session。验证当协议响应包含 secReqs/bifReqs struct 时，Session 中对应字段有值。

### H-3. spnPrefix 解析

`handshake.ts:131-134` 调用 `parseSpnPrefix(secToken, "krb5")`。验证：
- secToken 为 `"&P=krb5,host/realm&P=unix"` → `spnPrefix === "host"`
- secToken 为 `"&P=host&P=sss"` → `spnPrefix === undefined`（无 krb5 条目）
- 无 secToken → `spnPrefix === undefined`

### H-4. 非预期的协议响应状态码

`handshake.ts:90-95` 处理非 Error、非 OK 的协议响应状态码。构造一个 `status=4001` (kXR_attn) 的协议响应，验证抛出 "Unexpected protocol response status" 错误。

### H-5. 非预期的登录响应状态码

`handshake.ts:121-126` 处理非 Error、非 OK、非 Redirect 的登录响应状态码。构造一个 `status=4002` (kXR_authmore) 的登录响应，验证抛出 "Unexpected login response status" 错误。

### H-6. ServerInitHandShake 不同字段值

当前测试始终使用 `protover=0x520, msgval=1`。验证不同 protover 值（如 `0x400`）是否影响 Session 中的 `protocolVersion`。

### H-7. 验证 flags 参数

`handshake.ts:61` 使用 `flags = SecReqs | BifReqs`。验证发送的协议请求中 flags 字节包含这两个标志位。

### H-8. MockTransport 重复使用问题

`auth.test.ts` 和 `handshake.test.ts` 各自定义了几乎相同的 MockTransport 和 `buildResponseFrame`/`extractStreamId` 工具函数。建议提取到共享测试工具文件中以减少重复。
