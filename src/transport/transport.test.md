# transport.test.ts — Transport Unit Tests

Source: `src/transport/transport.test.ts`

Module under test: `Transport` — Low-level TCP transport that wraps `net.Socket` for sending and receiving raw bytes over a TCP connection.

Helper: `createEchoServer()` creates a local TCP server that echoes back any data it receives.

---

## 1. connects to a TCP server — ✅ 保留

Creates a local echo server, instantiates a `Transport`, calls `transport.connect("127.0.0.1", port)`, and asserts the connection succeeds without error. The transport is then closed and the server is torn down.

**Operation:** Basic TCP connection establishment.

## 2. sends and receives data — ✅ 保留

Creates a local echo server, connects a `Transport`, registers an `onData` callback, sends `Buffer.from("Hello, XRootD!")`, and asserts the received data matches the sent data exactly.

**Operation:** Round-trip data integrity — verify that bytes sent are the same bytes received from an echo server.

## 3. close destroys the socket — ✅ 保留

Creates a local echo server, connects a `Transport`, calls `transport.close()`, then attempts to send data. Asserts that the send throws an `Error` because the socket has been destroyed.

**Boundary case:** Sending data after a graceful close must fail. Verifies that `close()` properly tears down the underlying socket.

## 4. destroy destroys the socket — ✅ 保留

Creates a local echo server, connects a `Transport`, calls `transport.destroy()` (immediate destruction), then attempts to send data. Asserts that the send throws an `Error`.

**Boundary case:** Sending data after `destroy()` must fail. Verifies that `destroy()` immediately invalidates the socket, similar to `close()` but non-graceful.

## 5. handles multiple send/receive cycles — ✅ 保留

Creates a local echo server, connects a `Transport`, then sends three messages (`"first"`, `"second"`, `"third"`) with small delays between each. Accumulates all received chunks and asserts the concatenated result equals `"firstsecondthird"`.

**Boundary case:** Verifies that the transport correctly handles interleaved send/receive operations and that data from multiple sends is not lost or corrupted when received in sequence.

---

## 需要补充的测试

### T-1. TLS 连接 — 🔴 需要添加

`transport.ts:104-120` 中的 `tlsConnect()` 方法完全未测试。测试用例：
- 创建一个 TLS echo server（使用自签名证书），以 `useTls=true` 调用 `connect()`，验证连接成功并能收发数据。
- 传入 `rejectUnauthorized: false` 验证自签名证书被接受。

### T-2. 连接失败处理 — 🔴 需要添加

`transport.ts:97-101` 中的 `tcpConnect()` 错误路径未测试。测试用例：
- 尝试连接到一个不存在的端口（如 `127.0.0.1:1`），验证 `connect()` 抛出错误。

### T-3. onError 回调 — 🔴 需要添加

`transport.ts:40-42` — 当 socket 发生错误时，`errorCallback` 应被调用。测试用例：
- 注册 `onError` 回调，触发 socket 错误（如连接中断），验证回调被调用。

### T-4. onClose 回调 — 🟡 需要添加

`transport.ts:36-38` — 当 socket 关闭时，`closeCallback` 应被调用。测试用例：
- 注册 `onClose` 回调，关闭远端 socket，验证回调被调用。

### T-5. removeDataHandler — 🟡 需要添加

`transport.ts:73-78` — 验证移除 data handler 后不再收到数据。测试用例：
- 注册两个 data handler，移除其中一个，发送数据，验证只有剩余的 handler 被调用。

### T-6. 多个 data handler — 🟡 需要添加

验证同时注册多个 `onData` handler 时，所有 handler 都被调用。

### T-7. 大数据发送 — 🔵 可选

发送大 buffer（如 1MB），验证数据完整性。此测试可选，因为 TCP 本身保证了可靠性。

### T-8. 并发发送 — 🔵 可选

同时发送多个 buffer，验证数据不交错。此测试可选，因为 Node.js 的 `socket.write()` 保证顺序。
