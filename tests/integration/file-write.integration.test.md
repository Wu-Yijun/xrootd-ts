# file-write.integration.test.ts — File Write Integration Tests

Source: `tests/integration/file-write.integration.test.ts`

Tests file write operations against a real XRootD server: creating files, writing data, partial overwrites, append mode, sync, truncate, and file state error handling. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection. Uses `ensureTestWriteDir()` in `before()` to create the test write directory if it doesn't exist.

---

## Integration: File.write

### 1. write data to a new file and verify size via stat

Opens a new file with `Write | New`, writes `"Hello, XRootD write!"`, closes it. Reopens the file, calls `stat()`, and asserts `info.size === BigInt(data.byteLength)`.

**Operation:** Happy path — write creates a file with the correct size.

### 2. write then read back verifies content integrity

Writes `"Round-trip test: 中文 + special chars: @#$%^&*()"`, closes, reopens for read, reads the same number of bytes, and asserts the decoded text matches exactly.

**Operation:** Write-read round-trip with Unicode and special characters — verifies content integrity.

### 3. write at offset overwrites partial content

Writes `"AAAA"` at offset 0, then `"BB"` at offset 2. Reads 4 bytes and asserts the result is `"AABB"`.

**Edge case:** Writing at a non-zero offset overwrites existing bytes without shifting data.

### 4. multiple sequential writes to same file

Writes `"Part1-"` at offset 0, `"Part2-"` at offset 6, `"Part3"` at offset 12. Reads 17 bytes and asserts `"Part1-Part2-Part3"`.

**Operation:** Sequential writes at increasing offsets produce concatenated content.

### 5. write on closed file throws XRootDError code 3004

Attempts `file.write()` on a `File` that was never opened. Asserts throws `XRootDError` code 3004 (FileNotOpen).

**Edge case:** Write on a closed/unopened file is rejected.

---

## Integration: File.open with Write flags

### 6. OpenFlags.Write opens existing file for writing

Creates a file with `"original"`, reopens with `OpenFlags.Write`, writes `"updated"`, reads back and asserts `"updated"`.

**Operation:** `OpenFlags.Write` opens an existing file for writing (overwrites).

### 7. OpenFlags.Write | OpenFlags.New creates file if not exists

Opens a non-existent path with `Write | New`, writes `"created"`, reads back and asserts `"created"`.

**Operation:** `Write | New` creates a new file when it doesn't exist.

### 8. OpenFlags.Append writes to end of file

Creates a file with `"Hello"`, reopens with `Write | Append`, writes `" World"` at offset 5. Reads 11 bytes and asserts `"Hello World"`. Also asserts `stat().size === 11n`.

**Edge case:** Append mode allows writing at the end of the file. The offset parameter is still required.

---

## Integration: File.sync and truncate

### 9. sync on opened file does not throw

Opens a file for read, calls `sync()`. If the server returns an error, asserts it's either 3010 (NotAuthorized) or 3011 (NotFound) — some servers reject sync on read-only files.

**Edge case:** Sync behavior varies by server — some allow it, some reject with specific error codes.

### 10. sync on closed file throws XRootDError code 3004

Attempts `file.sync()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Sync on a closed file is rejected.

### 11. truncate on opened file does not throw

Opens a file for read, calls `truncate(0)`. If the server returns an error, asserts it's 3010 or 3011 (server-dependent behavior).

**Edge case:** Truncate behavior varies by server — some allow it on read-only files, some reject.

### 12. truncate on closed file throws XRootDError code 3004

Attempts `file.truncate(0)` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Truncate on a closed file is rejected.

---

## Integration: File state errors

### 13. read on closed file throws XRootDError code 3004

Attempts `file.read()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Read on a closed file is rejected.

### 14. stat on closed file throws XRootDError code 3004

Attempts `file.stat()` on an unopened file. Asserts throws `XRootDError` code 3004.

**Edge case:** Stat on a closed file is rejected.

### 15. double open on same File instance throws XRootDError

Opens a file, then attempts to open another path on the same `File` instance. Asserts throws `XRootDError`.

**Edge case:** A `File` instance can only hold one open handle at a time.

### 16. close is idempotent (no error on second close)

Opens a file, closes it, closes it again. Asserts no error on the second close and `file.isOpen === false`.

**Edge case:** Closing an already-closed file is a no-op, not an error.

---

## Integration: XRootDClient write flow

### 17. client.open with Write → write → close → read back

Uses the high-level `XRootDClient` API: opens with `Write | New`, writes `"client write test"`, closes, reopens for read, reads back and asserts content matches.

**Operation:** High-level client write API works correctly end-to-end.
