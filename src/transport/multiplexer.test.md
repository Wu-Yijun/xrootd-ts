# multiplexer.test.ts — Multiplexer Unit Tests

Source: `src/transport/multiplexer.test.ts`

Module under test: `Multiplexer` — Multiplexes multiple logical XRootD request/response streams over a single transport connection using stream IDs. Handles request matching, timeouts, kXR_wait/kXR_waitresp retries, and redirect responses.

Helper: `MockTransport` simulates a transport layer by capturing sent data and programmatically generating responses with specific stream IDs.

---

## Basic Request/Response Matching

### 1. basic request/response matching — ✅ 保留

Sends a single request via `mux.request(3006, body)`, simulates a response on the same stream ID with status `0`, and asserts the returned frame has `status === 0` and `dlen === 0`.

**Operation:** Verifies the core multiplexing mechanism — a request gets a response matched by stream ID.

### 2. multiple concurrent requests matched correctly — ✅ 保留

Sends two concurrent requests (`3006` and `3007`), extracts the stream IDs from the sent data, then responds to them **out of order** (responding to the second request first). Asserts both promises resolve with `status === 0`.

**Operation:** Concurrent request handling — responses must be matched to the correct pending request by stream ID regardless of arrival order.

## kXR_wait / kXR_waitresp Retry Mechanism

### 3. kXR_wait (4005) triggers retry — ✅ 保留

Sets a 10-second timeout, sends a request, and simulates a `4005` (kXR_wait) response with a 2-second wait body. After waiting ~2.1 seconds, simulates a successful `0` response. Asserts the final frame has `status === 0`.

**Operation:** The multiplexer should automatically retry after receiving a kXR_wait response, waiting the server-specified duration before resending.

### 4. kXR_waitresp (4006) triggers retry — ⚠️ 有错误需要修改

Same as above but with `4006` (kXR_waitresp) response code. Verifies that kXR_waitresp also triggers the automatic retry mechanism.

**问题：** 根据源码 `multiplexer.ts:162-166`，`kXR_waitresp (4006)` 的 `shouldRetry=false`，即**不应自动重发请求**。源码注释明确写道：`kXR_waitresp: server is processing, client MUST NOT retry. Wait for the kXR_attn async response to arrive.`

但当前测试描述为"triggers retry"，与源码行为矛盾。测试通过的原因可能是：timeout sweep 在 2.1 秒后过期并触发了新的请求，而非 `handleWaitResponse` 的重试逻辑。应修改测试以验证 `kXR_waitresp` 不触发重试（等待 async 响应），或修正测试描述以反映实际行为。

## Timeout and Close

### 5. timeout rejects pending request — ✅ 保留

Sets a 100ms timeout, sends a request, and asserts the promise is rejected with an error matching `/timeout/`.

**Boundary case:** When no response arrives within the configured timeout, the pending request must be rejected.

### 6. close() rejects all pending — ✅ 保留

Sends two concurrent requests, immediately calls `mux.close()`, and asserts both promises are rejected with errors matching `/closed/`.

**Boundary case:** When the multiplexer is closed, all pending requests must be rejected.

### 7. request after close throws — ✅ 保留

Calls `mux.close()` first, then attempts to send a new request. Asserts the promise is rejected with an error matching `/closed/`.

**Boundary case:** New requests cannot be created after the multiplexer has been closed.

## Redirect Handling

### 8. redirect detaches pending and passes to onRedirect — ✅ 保留

Creates a new multiplexer with an `onRedirect` callback. Sends a request, simulates a `4004` redirect response pointing to `newserver.example.com:1095`. Asserts:
- `onRedirect` is called with the correct host and port
- The pending request info (requestId, body, data) is passed to the handler
- The retried request (resubmitted inside the handler) succeeds with `status === 0`

**Operation:** Redirect response (4004) must detach the pending request from the multiplexer and pass it to the configured `onRedirect` handler, which can then re-issue the request.

### 9. rejects when no onRedirect handler configured — ✅ 保留

Sends a request on a multiplexer without an `onRedirect` handler, simulates a `4004` redirect response, and asserts the promise is rejected with an error matching `/no onRedirect handler/`.

**Boundary case:** When no redirect handler is configured, redirect responses must cause the request to fail.

### 10. redirect count increments and can be reset — ✅ 保留

Creates a multiplexer with `maxRedirects: 10`. Triggers two separate redirect sequences, calling `resetRedirectCount()` between them. Asserts `callCount` increments correctly (once per redirect) and that both requests succeed.

**Operation:** The redirect counter tracks cumulative redirects across requests and can be manually reset.

### 11. redirectCount can be initialized from options — ✅ 保留

Creates a multiplexer with `redirectCount: 1` and `maxRedirects: 2`. The first redirect increments count from 1 to 2 (succeeds). The second redirect would exceed `maxRedirects`, so it is rejected with `/Too many redirects/`.

**Boundary case:** Initial redirect count from options is respected, and exceeding `maxRedirects` triggers rejection.

---

## 需要补充的测试

### MX-1. kXR_attn (4001) 异步响应处理 — 🔴 需要添加

这是最关键的缺口。`handleAttnResponse()` 方法（`multiplexer.ts:193-218`）处理 `kXR_attn` 响应，当 `actnum=5008`（kXR_asynresp）时，从 body 中提取嵌入的响应帧并 resolve 对应的 pending request。

测试用例：
- 构造一个 `status=4001` 的帧，body 包含 `actnum=5008` + 嵌入的 streamId + innerStatus + innerDlen + innerBody。验证 pending request 被正确 resolve，返回的 frame 包含 innerStatus 和 innerBody。
- 构造 `actnum != 5008` 的 attn 帧，验证不处理（pending 不变）。
- 构造 body < 16 字节的 attn 帧，验证不处理。

### MX-2. Stream ID 耗尽 — 🔴 需要添加

`allocateStreamId()` 在所有 65535 个 stream ID 都被占用时抛出 `XRootDError`。验证：
- 创建 Multiplexer，填满所有 stream ID（需要大量的并发 pending request）。
- 第 65536 个请求应抛出错误，匹配 `/65535/`。

### MX-3. Stream ID 回绕 — 🟡 需要添加

验证当 stream ID 达到 `MAX_STREAM_ID (65535)` 后能正确回绕到 0。

### MX-4. send() 失败时的错误传播 — 🟡 需要添加

`multiplexer.ts:143` 中 `this.transport.send().catch(reject)` — 如果 transport.send 失败，promise 应被 reject。创建一个 send 会失败的 MockTransport，验证请求被 reject。

### MX-5. 多次 close() 调用 — 🟡 需要添加

`multiplexer.ts:321` 中 `if (this.closed) return;` — 第二次 close 不应抛错。验证连续调用两次 `close()` 不会抛出异常。

### MX-6. onRedirect handler 抛出异常 — 🟡 需要添加

`multiplexer.ts:267-269` 中 `.catch(err => pending.reject(err))` — 如果 onRedirect 回调自身抛出异常，pending 应被 reject。验证 onRedirect 中 throw 的错误能正确传播。

### MX-7. sweepTimeouts 清理多个过期请求 — 🟡 需要添加

验证 sweep 能同时清理多个过期的 pending request（当前仅测试单个）。

### MX-8. updateRedirectHandler / getTransport — 🔵 需要添加

简单的 getter/setter 测试：
- `updateRedirectHandler` 替换已有的 handler。
- `getTransport` 返回构造时传入的 transport 实例。
