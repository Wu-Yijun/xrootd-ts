# redirect.test.ts — E2E Redirect Flow Tests

Source: `tests/e2e/redirect.test.ts`

Tests the end-to-end redirect flow: a client connects to Server A, which responds to a login request with a `kXR_redirect` (4004) response pointing to Server B. The client's `onRedirect` handler closes the original connection, opens a new one to Server B, and retries the failed request. After redirect, the client successfully opens a file and reads data from Server B.

Infrastructure: Two real TCP servers (`serverA` and `serverB`) are spun up. `serverA` responds to protocol requests normally but sends a 4004 redirect on the login request. `serverB` handles all subsequent requests (login, open, read, close).

---

## 1. handles kXR_redirect from server A to server B — ✅ 保留

**Setup:**
- `serverA` on a random port: responds to `kXR_protocol` (3006) with success, responds to `kXR_login` (3007) with a 4004 redirect pointing to `serverB`'s port and host `"localhost"`.
- `serverB` on a random port: responds to `kXR_protocol`, `kXR_login`, `kXR_open` (3010) with a 4-byte file handle, `kXR_read` (3013) with `"Redirected data"`, and `kXR_close` (3003) with success.

**Flow:**
1. Client connects to `serverA`, creates a `Multiplexer` with `maxRedirects: 16`.
2. Sends `kXR_protocol` → succeeds on `serverA`.
3. Sends `kXR_login` → `serverA` responds with 4004 redirect.
4. `onRedirect` fires: closes `mux1` and `transport1`, opens new `transport2` to `serverB`, creates `mux2`, retries the login request on `mux2`.
5. Login succeeds on `serverB` (status 0).
6. Client creates a `File` on `mux2`, opens `/data/test.txt`, reads 100 bytes, asserts data is `"Redirected data"`.
7. Closes the file.

**Assertions:**
- `loginFrame.status === 0` (retry succeeded)
- `capturedRedirPort === serverB.port` (redirect port captured correctly)
- `file.isOpen === true` after open
- Read data equals `"Redirected data"`
- `serverBCalled === true` (server B actually received the login)

**Edge cases covered:**
- Full redirect cycle: connect → protocol → redirect → reconnect → retry → success
- Request retry after redirect preserves the original request ID and body
- File I/O operations work correctly after a redirect to a different server

---

## 需要补充的测试

### RD-1. 非 login 请求重定向 — 🔴 需要添加

在 kXR_open 或 kXR_read 上触发重定向（而非 kXR_login）。验证客户端正确处理非 login 请求的 4004 响应。

### RD-2. 链式重定向 (A → B → C) — 🔴 需要添加

Server A 重定向到 B，B 再重定向到 C。验证多跳重定向的正确处理和最终成功。

### RD-3. 重定向带 opaque 数据 — 🔴 需要添加

重定向 host 字符串包含 `?query=value`，验证 opaque 数据被正确解析和转发。

### RD-4. 重定向到不同主机 — 🔴 验证

目前只测试 localhost。验证重定向到不同主机名（如 `"remotehost"`）时的行为。

### RD-5. maxRedirects 耗尽 — 🔴 需要添加

`client-redirect.test.md` 测试了此场景，但在 `redirect.test.md` 中应在 mux 级别验证：重定向到自己，超过 maxRedirects 后请求被拒绝。

### RD-6. 重定向期间文件操作 — 🟡 需要添加

在文件操作（如 read）过程中收到重定向，验证请求在新服务器上重试。

### RD-7. kXR_locate 响应 — 🔴 需要添加

kXR_locate (3027) 返回类似重定向的位置信息。验证此响应类型的处理。
