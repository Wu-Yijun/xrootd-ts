# auth.test.ts — Auth Framework Unit Tests

Source: `src/session/auth.test.ts`

Module under test: `doAuthentication()` and `registerAuthProtocol()` — The authentication framework that orchestrates multi-round authentication with XRootD servers. Selects a supported protocol, sends auth credentials, and handles authmore (4002) and error (4003) responses.

Helper: `MockTransport` simulates transport responses. `MockAuthProtocol` is a test security protocol implementation.

---

## 1. skips authentication when no protocols required — ✅ 保留

Calls `doAuthentication(mux, [], params)` with an empty list of server-supported protocols. Asserts the returned `SecEntity` has `prot === ""`.

**Edge case:** When the server requires no authentication, the framework returns immediately without sending any auth requests.

## 2. authenticates with supported protocol — ✅ 保留

Registers a `MockAuthProtocol` (name: `"host"`) that returns credentials `[0xaa, 0xbb]`. Calls `doAuthentication(mux, ["host"], params)`, simulates a successful `0` response, and asserts:
- `entity.prot === "host"`
- `entity.name === "testuser"`

**Operation:** Happy path — server advertises a supported protocol, client authenticates successfully.

## 3. throws when no supported protocol — ✅ 保留

Calls `doAuthentication(mux, ["unsupported"], params)` with no registered protocol matching `"unsupported"`. Asserts the promise is rejected with `err.code === 3030` (Authentication failed).

**Error case:** Server advertises protocols the client cannot handle.

## 4. handles multi-round authentication — ✅ 保留

Registers a `MultiRoundAuth` protocol (name: `"sss"`) that requires two rounds (returns `isComplete() === false` until called twice). The test simulates:
1. First request → `4002` (authmore)
2. Second request → `4002` (authmore)
3. Third request → `0` (success)

Asserts `entity.prot === "sss"` after the full sequence.

**Operation:** Multi-round (challenge-response) authentication where the server asks for additional rounds before accepting.

## 5. throws on auth failure — ✅ 保留

Registers a `MockAuthProtocol` (name: `"host"`), sends a request, then simulates a `4003` error response with errnum 3030 and message "Auth failed". Asserts the promise is rejected with `err.code === 3030`.

**Error case:** Server explicitly rejects the authentication attempt with an error response.

---

## 需要补充的测试

### A-1. protocolFilter 选项

`auth.ts:35-38` 中的 `protocolFilter` 选项未测试。测试用例：
- 服务器提供 `["host", "sss", "krb5"]`，`protocolFilter: ["host"]` → 仅尝试 `"host"`
- 服务器提供 `["host", "sss"]`，`protocolFilter: ["krb5"]` → 无匹配，抛出 3030 错误

### A-2. 多协议回退

服务器提供 `["krb5", "host"]`，仅 `"host"` 已注册。验证：
- `krb5` 被静默跳过（无工厂）
- `host` 被尝试并成功

### A-3. 所有协议失败

注册两个协议（如 `"host"` 和 `"sss"`），两者都返回 4003 错误。验证最终错误消息包含尝试的所有协议名称和最后一个错误消息。

### A-4. auth 请求 body 二进制格式

`auth.ts:74-76` 构建 `reserved[12] + credtype[4]`。验证发送的 body 中：
- offset 12-15 包含协议名称的 ASCII 字节（如 `"host"` = `[0x68, 0x6f, 0x73, 0x74]`）
- offset 0-11 全为零

### A-5. registerAuthProtocol 幂等性

对同一名称调用两次 `registerAuthProtocol`，验证第二次覆盖第一次（工厂函数被替换）。

### A-6. processChallenge 的 challenge 参数

验证 `processChallenge` 被调用时传入的 `challenge` 参数是 server 返回的 `frame.body`。
