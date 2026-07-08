# file-write.integration.test.ts — File Write Integration Tests

Source: `tests/integration/file-write.integration.test.ts`

Tests file write operations against a real XRootD server: creating files, writing data, partial overwrites, append mode, sync, truncate, and file state error handling. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection. Uses `ensureTestWriteDir()` in `before()` to create the test write directory if it doesn't exist.

---

## Integration: File.write

### 1. write data to a new file and verify size via stat — ✅ 保留

Opens a new file with `Write | New`, writes `"Hello, XRootD write!"`, closes it. Reopens the file, calls `stat()`, and asserts `info.size === BigInt(data.byteLength)`.

**Operation:** Happy path — write creates a file with the correct size.

### 2. write then read back verifies content integrity — ✅ 保留

Writes `"Round-trip test: 中文 + special chars: @#$%^&*()"`, closes, reopens for read, reads the same number of bytes, and asserts the decoded text matches exactly.

**Operation:** Write-read round-trip with Unicode and special characters — verifies content integrity.

### 3. write at offset overwrites partial content — ✅ 保留

Writes `"AAAA"` at offset 0, then `"BB"` at offset 2. Reads 4 bytes and asserts the result is `"AABB"`.

**Edge case:** Writing at a non-zero offset overwrites existing bytes without shifting data.

### 4. multiple sequential writes to same file — ✅ 保留

Writes `"Part1-"` at offset 0, `"Part2-"` at offset 6, `"Part3"` at offset 12. Reads 17 bytes and asserts `"Part1-Part2-Part3"`.

**Operation:** Sequential writes at increasing offsets produce concatenated content.

### 5. write on closed file throws XRootDError code 3004 — ✅ 保留

Attempts `file.write()` on a `File` that was never opened. Asserts throws `XRootDError` code 3004 (FileNotOpen).

**Edge case:** Write on a closed/unopened file is rejected.

---

## Integration: File.open with Write flags

### 6. OpenFlags.Write opens existing file for writing — ✅ 保留

Creates a file with `"original"`, reopens with `OpenFlags.Write`, writes `"updated"`, reads back and asserts `"updated"`.

**Operation:** `OpenFlags.Write` opens an existing file for writing (overwrites).

### 7. OpenFlags.Write | OpenFlags.New creates file if not exists — ✅ 保留

Opens a non-existent path with `Write | New`, writes `"created"`, reads back and asserts `"created"`.

**Operation:** `Write | New` creates a new file when it doesn't exist.

### 8. OpenFlags.Append writes to end of file — ✅ 保留

Creates a file with `"Hello"`, reopens with `Write | Append`, writes `" World"` at offset 5. Reads 11 bytes and asserts `"Hello World"`. Also asserts `stat().size === 11n`.

**Edge case:** Append mode allows writing at the end of the file. The offset parameter is still required.

---

## Integration: File.sync and truncate

### 9. sync on opened file does not throw — ✅ 保留

Opens a file for read, calls `sync()`. If the server returns an error, asserts it's either 3010 (NotAuthorized) or 3011 (NotFound) — some servers reject sync on read-only files.

**Edge case:** Sync behavior varies by server — some allow it, some reject with specific error codes.

### 10. sync on closed file throws XRootDError code 3004 — ✅ 保留

Attempts `file.sync()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Sync on a closed file is rejected.

### 11. truncate on opened file does not throw — ✅ 保留

Opens a file for read, calls `truncate(0)`. If the server returns an error, asserts it's 3010 or 3011 (server-dependent behavior).

**Edge case:** Truncate behavior varies by server — some allow it on read-only files, some reject.

### 12. truncate on closed file throws XRootDError code 3004 — ✅ 保留

Attempts `file.truncate(0)` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Truncate on a closed file is rejected.

---

## Integration: File state errors

### 13. read on closed file throws XRootDError code 3004 — ✅ 保留

Attempts `file.read()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Read on a closed file is rejected.

### 14. stat on closed file throws XRootDError code 3004 — ✅ 保留

Attempts `file.stat()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Stat on a closed file is rejected.

### 15. double open on same File instance throws XRootDError — ✅ 保留

Opens a file, then attempts to open another path on the same `File` instance. Asserts throws `XRootDError`.

**Edge case:** A `File` instance can only hold one open handle at a time.

### 16. close is idempotent (no error on second close) — ✅ 保留

Opens a file, closes it, closes it again. Asserts no error on the second close and `file.isOpen === false`.

**Edge case:** Closing an already-closed file is a no-op, not an error.

---

## Integration: XRootDClient write flow

### 17. client.open with Write → write → close → read back — ✅ 保留

Uses the high-level `XRootDClient` API: opens with `Write | New`, writes `"client write test"`, closes, reopens for read, reads back and asserts content matches.

**Operation:** High-level client write API works correctly end-to-end.

---

## 需要补充的测试

### IFW-1. 大块写入 — 🟡 需要添加

写入大块数据（如 1MB），验证多块传输正确处理。

### IFW-2. OpenFlags.Delete — 🔴 需要添加

使用 `OpenFlags.Delete` 打开文件，验证文件在 close 后被删除。

### IFW-3. OpenFlags.Mkpath — 🔴 需要添加

使用 `OpenFlags.Mkpath` 创建深层路径文件，验证中间目录被自动创建。

### IFW-4. truncate 到非零大小 — 🟡 需要添加

`truncate(10)` 将文件截断到 10 字节，验证 stat 显示正确大小。

### IFW-5. sync 后数据持久化 — 🟡 需要添加

write + sync 后重新读取，验证数据完整。

### IFW-6. Append 模式连续写入 — 🟡 验证

多次 Append 写入后验证所有数据按顺序追加。

### IFW-7. Write 覆盖大文件 — 🟡 需要添加

创建大文件后用 Write 模式完全覆盖新数据，验证旧数据被替换。
