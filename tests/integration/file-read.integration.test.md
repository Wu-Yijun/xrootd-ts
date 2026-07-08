# file-read.integration.test.ts — File Read Integration Tests

Source: `tests/integration/file-read.integration.test.ts`

Tests file read operations against a real XRootD server: basic read, offset/size reads, multiple sequential reads, edge cases (oversized reads, near-end reads), and the `XRootDClient` high-level read API. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection. Uses `EXPECTED_FILE_CONTENTS` (5-line test file) as the reference data.

---

## Integration: file read flow

### 1. login → open → read → close

Full low-level flow: creates Transport/Multiplexer, performs handshake, opens `TEST_FILE_PATH`, reads the entire file content (`EXPECTED_FILE_CONTENTS.length` bytes), asserts the decoded text matches `EXPECTED_FILE_CONTENTS` exactly. Closes file and verifies `isOpen === false`.

**Operation:** Happy path — complete read lifecycle from handshake to close.

### 2. read with offset and size

Opens the test file, reads 5 bytes from offset 0. Asserts decoded text is `"Hello"`.

**Operation:** Partial read from the beginning of the file.

### 3. read with offset skips bytes

Opens the test file, reads 6 bytes from offset 7. Asserts decoded text is `"XRootD"`.

**Edge case:** Non-zero offset correctly skips bytes before reading.

### 4. open non-existent file throws XRootDError

Attempts to open `"/data/nonexistent_file_12345.txt"`. Asserts throws `XRootDError` with code 3011 (NotFound).

**Error case:** Server returns "not found" for a non-existent file.

### 5. stat on opened file returns valid info

Opens the test file, calls `file.stat()`. Asserts:
- `info.size > 0n`
- `info.size === BigInt(Buffer.byteLength(EXPECTED_FILE_CONTENTS))`

**Operation:** Stat on an opened file returns the correct file size.

### 6. multiple sequential reads

Opens the test file, reads three 5-byte chunks at offsets 0, 5, 10. Asserts:
- Chunk 1: `"Hello"`
- Chunk 2: `", XRo"`
- Chunk 3: `"otD!\n"`

**Operation:** Sequential reads at different offsets correctly read different parts of the file.

---

## Integration: XRootDClient file operations

### 7. client.open → read → close

Uses `XRootDClient`: connects, opens test file, reads 5 bytes, asserts `"Hello"`, closes file and verifies `isOpen === false`. After client close, asserts `client.isConnected === false`.

**Operation:** High-level client read API works correctly.

### 8. client.stat returns valid info

Uses `XRootDClient`: connects, calls `client.stat(TEST_FILE_PATH)`, asserts `size > 0n`.

**Operation:** High-level client stat API works correctly.

### 9. client.open non-existent file throws

Uses `XRootDClient`: connects, attempts to open a non-existent file. Asserts throws `XRootDError` with code 3011 or 3010 (server-dependent).

**Error case:** High-level client propagates server errors correctly.

---

## Integration: file read edge cases

### 10. read with size larger than file returns available bytes

Opens the test file, requests `actualSize + 1000` bytes. Asserts:
- `data.length > 0`
- `data.length <= actualSize`
- Decoded text starts with `"Hello"`

**Edge case:** When the requested read size exceeds the file, the server returns only the available bytes (up to EOF).

### 11. read at offset near end returns fewer bytes

Opens the test file, reads from `offset = actualSize - 5` with size 1000. Asserts the result equals `EXPECTED_FILE_CONTENTS.slice(offset)`.

**Edge case:** Reading near the end of the file returns only the remaining bytes, even if more were requested.

### 12. sequential reads produce consistent results

Opens the test file, reads 10 bytes from offset 0 twice. Asserts the two reads return identical byte arrays.

**Operation:** File reads are deterministic — reading the same offset/size twice returns the same data.
