# file-read.integration.test.ts — File Read Integration Tests

Source: `tests/integration/file-read.integration.test.ts`

Tests file read operations against a real XRootD server: basic read, offset/size reads, multiple sequential reads, edge cases (oversized reads, near-end reads), and the `XRootDClient` high-level read API. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection. Uses `EXPECTED_FILE_CONTENTS` (5-line test file) as the reference data.

---

## Integration: file read flow

### 1. login → open → read → close — ✅ 保留

Full low-level flow: creates Transport/Multiplexer, performs handshake, opens `TEST_FILE_PATH`, reads the entire file content (`EXPECTED_FILE_CONTENTS.length` bytes), asserts the decoded text matches `EXPECTED_FILE_CONTENTS` exactly. Closes file and verifies `isOpen === false`.

**Operation:** Happy path — complete read lifecycle from handshake to close.

### 2. read with offset and size — ✅ 保留

Opens the test file, reads 5 bytes from offset 0. Asserts decoded text is `"Hello"`.

**Operation:** Partial read from the beginning of the file.

### 3. read with offset skips bytes — ✅ 保留

Opens the test file, reads 6 bytes from offset 7. Asserts decoded text is `"XRootD"`.

**Edge case:** Non-zero offset correctly skips bytes before reading.

### 4. open non-existent file throws XRootDError — ✅ 保留

Attempts to open `"/data/nonexistent_file_12345.txt"`. Asserts throws `XRootDError` with code 3011 (NotFound).

**Error case:** Server returns "not found" for a non-existent file.

### 5. stat on opened file returns valid info — ✅ 保留

Opens the test file, calls `file.stat()`. Asserts:
- `info.size > 0n`
- `info.size === BigInt(Buffer.byteLength(EXPECTED_FILE_CONTENTS))`

**Operation:** Stat on an opened file returns the correct file size.

### 6. multiple sequential reads — ✅ 保留

Opens the test file, reads three 5-byte chunks at offsets 0, 5, 10. Asserts:
- Chunk 1: `"Hello"`
- Chunk 2: `", XRo"`
- Chunk 3: `"otD!\n"`

**Operation:** Sequential reads at different offsets correctly read different parts of the file.

---

## Integration: XRootDClient file operations

### 7. client.open → read → close — ✅ 保留

Uses `XRootDClient`: connects, opens test file, reads 5 bytes, asserts `"Hello"`, closes file and verifies `isOpen === false`. After client close, asserts `client.isConnected === false`.

**Operation:** High-level client read API works correctly.

### 8. client.stat returns valid info — ✅ 保留

Uses `XRootDClient`: connects, calls `client.stat(TEST_FILE_PATH)`, asserts `size > 0n`.

**Operation:** High-level client stat API works correctly.

### 9. client.open non-existent file throws — ✅ 保留

Uses `XRootDClient`: connects, attempts to open a non-existent file. Asserts throws `XRootDError` with code 3011 or 3010 (server-dependent).

**Error case:** High-level client propagates server errors correctly.

---

## Integration: file read edge cases

### 10. read with size larger than file returns available bytes — ✅ 保留

Opens the test file, requests `actualSize + 1000` bytes. Asserts:
- `data.length > 0`
- `data.length <= actualSize`
- Decoded text starts with `"Hello"`

**Edge case:** When the requested read size exceeds the file, the server returns only the available bytes (up to EOF).

### 11. read at offset near end returns fewer bytes — ✅ 保留

Opens the test file, reads from `offset = actualSize - 5` with size 1000. Asserts the result equals `EXPECTED_FILE_CONTENTS.slice(offset)`.

**Edge case:** Reading near the end of the file returns only the remaining bytes, even if more were requested.

### 12. sequential reads produce consistent results — ✅ 保留

Opens the test file, reads 10 bytes from offset 0 twice. Asserts the two reads return identical byte arrays.

**Operation:** File reads are deterministic — reading the same offset/size twice returns the same data.

---

## 需要补充的测试

### IFR-1. 从空文件读取 — 🔴 需要添加

读取空文件（0 字节），验证返回空 Buffer/Uint8Array。

### IFR-2. 偏移量超出文件大小 — 🔴 需要添加

读取偏移量 > 文件大小，验证返回空数据或 EOF 错误。

### IFR-3. 读取零字节 — 🔴 需要添加

`file.read(offset, 0)` 请求 0 字节，验证行为。

### IFR-4. 负偏移量 — 🔴 需要添加

`file.read(-1, 10)` 负偏移量，验证是否抛出错误。

### IFR-5. OpenFlags.Retstat — 🔴 需要添加

使用 `OpenFlags.Retstat` 打开文件，验证 open 返回 stat 信息。

### IFR-6. OpenFlags.Compress — 🔴 需要添加

使用 `OpenFlags.Compress` 打开文件，验证服务器处理压缩请求。

### IFR-7. 并发读取同一文件 — 🟡 需要添加

多个 File 实例同时读取同一文件，验证数据一致性。

### IFR-8. 读取二进制数据 — 🟡 需要添加

读取包含二进制数据的文件，验证 Uint8Array 内容正确。
