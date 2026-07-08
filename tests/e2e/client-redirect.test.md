# client-redirect.test.ts — E2E Client-Side Redirect Auto-Handling Tests

Source: `tests/e2e/client-redirect.test.ts`

Tests client-side redirect handling: the `onRedirect` callback in the `Multiplexer` that automatically reconnects and retries when a server responds with `kXR_redirect` (4004). Covers successful redirect, redirect loops, and redirect to unreachable servers.

Infrastructure:
- `createRedirectServer(redirectHost, redirectPort, redirectOnRequest)` — a server that responds normally to protocol but sends 4004 on a specific request ID.
- `createTargetServer(openFileHandle, readData)` — a server that handles all requests normally (protocol, login, open, read, close).

---

## 1. auto-reconnects from server A to server B on redirect — ✅ 保留

**Setup:**
- `serverA` redirects on `kXR_login` (3007) → points to `serverB`'s port.
- `serverB` handles all requests normally.

**Flow:**
1. Connects to `serverA`, creates `Multiplexer` with `maxRedirects: 3` and `onRedirect` handler.
2. Sends `kXR_protocol` → succeeds on `serverA`.
3. Sends `kXR_login` → `serverA` responds with 4004.
4. `onRedirect` fires: closes old mux/transport, connects to `serverB`, creates new mux, retries login.
5. Login succeeds on `serverB`.

**Assertions:**
- `loginFrame.status === 0` (retry succeeded)
- `host === "127.0.0.1"` and `port === serverB.port` inside `onRedirect`

**Operation:** Successful redirect from one server to another with automatic reconnection.

## 2. too many redirects rejects with error — ✅ 保留

**Setup:** A single server that **always** responds with 4004 redirect pointing back to itself (redirect loop).

**Flow:**
1. Connects, creates `Multiplexer` with `maxRedirects: 3`.
2. Protocol succeeds.
3. Login triggers redirect → `onRedirect` retries on same mux → server redirects again → …
4. After exceeding `maxRedirects`, the request is rejected.

**Assertions:**
- The promise rejects with an error matching `/redirect/i`

**Edge case:** Infinite redirect loops must be broken by the `maxRedirects` limit. The client must not loop forever.

## 3. redirect to unreachable server rejects with connection error — ✅ 保留

**Setup:** A server that redirects on login to port 1 (unreachable — nothing listens there).

**Flow:**
1. Connects, creates `Multiplexer` with `maxRedirects: 3` and `onRedirect` handler.
2. Protocol succeeds.
3. Login triggers redirect to port 1.
4. `onRedirect` attempts `transport.connect("127.0.0.1", 1)` — connection refused.
5. The catch block rejects the pending request with `"Connection to redirect target failed"`.

**Assertions:**
- The promise rejects with an `Error` instance

**Edge case:** When the redirect target is unreachable, the client must not hang — it must propagate the connection error and reject the pending request.

---

## 需要补充的测试

### CR-1. 非 login 请求的重定向 — 🔴 需要添加

在 kXR_open 或 kXR_read 上触发重定向（而非 kXR_login），验证自动重连和重试。

### CR-2. 重定向带 opaque 数据 — 🔴 需要添加

host 字符串包含 `?opaque=data`，验证 opaque 数据被正确转发到新服务器。

### CR-3. 链式重定向 (A → B → C) — 🔴 需要添加

通过 3 台服务器的多跳重定向，验证最终成功。

### CR-4. XRootDClient 级别重定向 — 🔴 需要添加

使用高层 `XRootDClient` 类（`src/client.ts`）验证重定向自动处理。`client.ts` 有 `handleRedirect` 方法但无 E2E 测试。

### CR-5. 重定向后 sessid 恢复 — 🔴 需要添加

重定向后必须重新获取 sessid。验证新服务器的 login 返回新的 sessid，客户端使用新 sessid 继续操作。

### CR-6. 活跃文件操作期间重定向 — 🟡 需要添加

在 read 操作进行中收到重定向，验证请求在新服务器上正确重试。

### CR-7. 重定向到不同主机名 — 🔴 验证

目前只测试 `127.0.0.1`/`localhost`。验证重定向到不同主机名时的行为。
