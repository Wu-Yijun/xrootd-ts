# filesystem.integration.test.ts — FileSystem Read-Only Integration Tests

Source: `tests/integration/filesystem.integration.test.ts`

Tests read-only `FileSystem` operations (`stat`, `readdir`) against a real XRootD server. Also tests the `XRootDClient` convenience wrappers for filesystem operations. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection to `XROOTD_HOST:XROOTD_PORT`. Uses `createConnectedFileSystem()` helper that performs full handshake and returns a ready `FileSystem` instance.

---

## Integration: FileSystem.stat

### 1. stat on existing file returns valid StatInfo

Calls `fs.stat(TEST_FILE_PATH)` and asserts:
- `info` is defined
- `info.size > 0n`
- `info.isDirectory === false`

**Operation:** Happy path — stat on a known test file returns valid metadata.

### 2. stat on directory returns valid StatInfo

Calls `fs.stat("/data/test")` and asserts:
- `info` is defined
- `info.id` is a string
- `info.size >= 0n`
- `info.mtime > 0`

**Operation:** Stat on a directory returns valid metadata with directory-appropriate values.

### 3. stat on non-existent path throws XRootDError

Calls `fs.stat("/data/nonexistent_path_12345")` and asserts:
- Throws `XRootDError`
- `err.code === 3011` (NotFound)

**Error case:** Server returns "not found" for a non-existent path.

---

## Integration: FileSystem.readdir

### 4. readdir on directory returns DirectoryList with entries

Calls `fs.readdir("/data/test")` and asserts:
- `list.name === "/data/test"`
- `list.entries` is an array with length > 0
- Entries include `"testfile.txt"`

**Operation:** Happy path — directory listing returns expected entries.

### 5. readdir on root returns directory listing

Calls `fs.readdir("/data")` and asserts the list has entries.

**Operation:** Readdir on a parent directory returns its children.

---

## Integration: XRootDClient filesystem operations

### 6. client.statFilesystem returns valid info

Uses `XRootDClient`, calls `client.statFilesystem(TEST_FILE_PATH)`. Asserts `size > 0n` and `mtime > 0`.

**Operation:** High-level client stat wrapper works correctly.

### 7. client.readdir returns directory listing

Uses `XRootDClient`, calls `client.readdir("/data/test")`. Asserts entries include `"testfile.txt"`.

**Operation:** High-level client readdir wrapper works correctly.

---

## Integration: FileSystem.readdir entry fields

### 8. readdir entries have correct types for all fields

Iterates over readdir entries and asserts each has `name` (string), `size` (number), `flags` (number), `mtime` (number), and non-empty name.

**Operation:** Type validation of directory entry fields from a live server.

### 9. testfile.txt entry has correct size

Finds the `testfile.txt` entry in the readdir result and asserts it exists.

**Edge case:** Specific file presence validation in directory listing.

---

## Integration: FileSystem.stat on root

### 10. stat on /data returns valid directory info

Calls `fs.stat("/data")` and asserts `isDirectory === true` and `mtime > 0`.

**Operation:** Stat on a known directory confirms directory type detection.
