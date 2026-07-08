# read.test.ts — E2E Read Flow Tests

Source: `tests/e2e/read.test.ts`

Tests the complete XRootD read workflow: protocol negotiation → login → open → read → close. Uses a simulated XRootD server that handles the full handshake sequence including the merged ClientInitHandShake + kXR_protocol initial message.

Infrastructure: `createSimulatedServer()` creates a real TCP server that:
- Detects the merged 44-byte ClientInitHandShake + kXR_protocol message and responds with ServerInitHandShake + protocol response.
- Handles `kXR_login` (3007) with a 16-byte sessid.
- Handles `kXR_open` (3010) with a 4-byte file handle `[0xaa, 0xbb, 0xcc, 0xdd]`.
- Handles `kXR_read` (3013) with `"Hello, XRootD!"`.
- Handles `kXR_close` (3003) with success.
- Returns error 3006 for unrecognized requests.

---

## 1. completes login → open → read → close — ✅ 保留

**Flow (manual protocol/login steps):**
1. Creates `Transport`, connects to the simulated server.
2. Creates a `Multiplexer`.
3. Sends `kXR_protocol` (3006) → asserts status 0.
4. Sends `kXR_login` (3007) → asserts status 0, extracts 16-byte sessid.
5. Constructs a `Session` object with `sessid`, `protocolVersion: 0x520`, `needsAuth: false`.
6. Creates a `File` with the session.
7. Opens `/data/test.txt` with `flags: 0x0010` (read) → asserts `file.isOpen === true`.
8. Reads 100 bytes from offset 0 → asserts decoded text is `"Hello, XRootD!"`.
9. Closes the file → asserts `file.isOpen === false`.
10. Closes mux and transport.

**Assertions:**
- Protocol and login succeed
- File opens successfully
- Read data matches expected content
- File closes cleanly

**Operation:** End-to-end read path using manual protocol/login steps.

## 2. completes handshake() → open → read → close — ✅ 保留

**Flow (using `handshake()` function):**
1. Creates `Transport`, connects to the simulated server.
2. Creates a `Multiplexer`.
3. Constructs an `XRootDUrl` pointing to the server.
4. Calls `handshake(mux, url)` which performs the full handshake automatically.
5. Asserts `session.sessid.length === 16` and `session.protocolVersion > 0`.
6. Creates a `File` with the session.
7. Opens `/data/test.txt` → asserts open.
8. Reads 100 bytes → asserts `"Hello, XRootD!"`.
9. Closes → asserts closed.

**Assertions:**
- `handshake()` correctly negotiates protocol and login
- Session has valid sessid (16 bytes) and protocol version
- File read works identically to the manual flow

**Edge case:** Validates that the `handshake()` helper function correctly handles the merged ClientInitHandShake + kXR_protocol message from the server, and produces a usable session for subsequent file operations.

---

## 需要补充的测试

### R-1. kXR_write 写入流程 — 🔴 需要添加

`File.write()` 存在但无 E2E 测试。服务器模拟 kXR_write，验证写入数据与服务器收到的一致。包括：正常写入、偏移写入、大文件写入。

### R-2. kXR_stat 对已打开文件 — 🔴 需要添加

`File.stat()` 存在但无 E2E 测试。服务器模拟 kXR_stat 响应，验证 stat 结果包含正确的文件属性。

### R-3. kXR_sync — 🔴 需要添加

`File.sync()` 存在但无 E2E 测试。验证 sync 请求成功发送且服务器确认。

### R-4. kXR_truncate — 🔴 需要添加

`File.truncate()` 存在但无 E2E 测试。验证 truncate 请求成功发送。

### R-5. 偏移量 > 0 的读取 — 🔴 需要添加

测试 `file.read(10, 100)` 从偏移 10 开始读取。服务器应返回从偏移 10 开始的数据。

### R-6. 读取超过 EOF — 🔴 需要添加

测试读取大小超过文件实际数据长度，验证返回部分数据或 EOF 标志。

### R-7. Oksofar 部分读取 — 🔴 需要添加

服务器返回 status 4000（Oksofar），表示部分读取成功。代码处理此状态但无 E2E 测试。

### R-8. close 后读取 — 🔴 需要添加

调用 `file.close()` 后再调用 `file.read()`，验证抛出 `FileNotOpen` 错误。

### R-9. 不同 open flags — 🔴 需要添加

测试不同打开标志：Write (0x0020)、Append (0x0200)、New (0x0008)、Delete (0x0002)、Mkpath (0x0100)、Retstat (0x0400)。

### R-10. 文件双开 — 🔴 需要添加

对已打开的文件再次调用 `open()`，验证抛出 `FileNotOpen` 错误。

### R-11. close 幂等性 — 🟡 需要添加

调用 `file.close()` 两次，验证第二次调用不抛出异常或正确处理。

### R-12. write + read 往返验证 — 🟡 需要添加

写入数据后读取，验证读取的内容与写入的一致。

### R-13. 大数据传输 — 🟡 需要添加

读取/写入大块数据（如 1MB），验证多块传输正确处理。
