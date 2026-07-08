# types.integration.test.ts — Type Validation Integration Tests

Source: `tests/integration/types.integration.test.ts`

Validates that the TypeScript types and constants used across the library are correct at runtime. Tests both live server responses (StatInfo, DirectoryEntry types) and static constant values (OpenFlags, StatFlags, DirlistOptions, protocol constants). All server-dependent tests are skipped when the XRootD server is unavailable.

---

## Integration: StatInfo type validation

### 1. stat returns StatInfo with correct types for all fields

Connects to the server, calls `client.stat(TEST_FILE_PATH)`, and asserts the runtime type of every field:
- `id`: string
- `size`: bigint
- `flags`: number
- `mtime`: number
- `ctime`: number
- `atime`: number
- `mode`: number
- `owner`: string
- `group`: string
- `isDirectory`: boolean
- `isLink`: boolean
- `isOffline`: boolean
- `isCached`: boolean

**Operation:** Validates that the stat response parser correctly maps XRootD's text-based stat format to typed TypeScript fields.

### 2. stat on directory sets isDirectory = true

Calls `client.statFilesystem("/data/test")` and asserts `info.isDirectory === true`.

**Edge case:** Directory detection via the mode bits in the stat response.

### 3. stat on file sets isDirectory = false

Calls `client.stat(TEST_FILE_PATH)` and asserts `info.isDirectory === false`.

**Edge case:** Regular file detection.

### 4. createStatInfo parser returns correct types

Calls `createStatInfo()` with a manually constructed stat string `"12345 6789 3 1700000000 1700000100 1700000200 100644 root group"` and asserts:
- `id === "12345"` (string)
- `size === 6789n` (bigint)
- `flags === 3` (number)
- `mtime === 1700000000`, `ctime === 1700000100`, `atime === 1700000200`
- `mode === 0o100644` (octal parse from decimal)
- `owner === "root"`, `group === "group"`

**Operation:** Unit-level validation of the stat string parser without a live server.

### 5. createStatInfo detects directory from mode

Parses stat string with mode `040755` (directory) and asserts `isDirectory === true`.

**Edge case:** Mode `0o040000` set in the mode field indicates a directory.

### 6. createStatInfo detects symlink from mode

Parses stat string with mode `120777` (symlink) and asserts `isLink === true`.

**Edge case:** Mode `0o120000` set in the mode field indicates a symbolic link.

---

## Integration: DirectoryEntry type validation

### 7. readdir entries have correct types

Connects, calls `client.readdir("/data/test")`, iterates over entries, and asserts each entry has:
- `name`: string (non-empty)
- `size`: number
- `flags`: number
- `mtime`: number

**Operation:** Validates directory listing entry types from a live server.

### 8. readdir name matches requested path

Asserts `list.name === "/data/test"` — the returned list name matches the requested path.

**Edge case:** The `name` field in `DirectoryList` must match the path that was requested.

---

## Integration: OpenFlags constants

### 9. OpenFlags enum values are correct

Asserts all 16 `OpenFlags` enum values match their expected hex values (Compress=0x0001 through Wrto=0x8000).

**Operation:** Static constant validation — ensures the enum hasn't been accidentally modified.

### 10. OpenFlags can be combined with bitwise OR

Asserts `OpenFlags.Write | OpenFlags.New === 0x0028`.

**Operation:** Bitwise combination of flags is the expected way to specify multiple open options.

---

## Integration: StatFlags constants

### 11. StatFlags enum values are correct

Asserts all `StatFlags` values: XBitSet=1, IsDir=2, Other=4, Offline=8, Readable=16, Writable=32, POSCPending=64, BackUpExists=128, CacheResp=512.

**Operation:** Static constant validation.

---

## Integration: DirlistOptions constants

### 12. DirlistOptions values are correct

Asserts: Online=1, Dstat=2, Dcksm=4, Dstatx=8.

**Operation:** Static constant validation.

---

## Integration: XRootDError class

### 13. codeToMessage returns correct messages for known codes

Asserts `codeToMessage()` for: NotFound → "File not found", NotAuthorized → "Not authorized", ItExists → "File already exists", IsDirectory → "Is a directory", Timeout → "Timeout", Disconnected → "Disconnected".

**Operation:** Error code to message mapping.

### 14. codeToMessage returns fallback for unknown codes

Asserts `codeToMessage(9999)` contains `"9999"`.

**Edge case:** Unknown codes produce a generic message with the code number.

### 15. error instances have correct name and code

Constructs `new XRootDError(3011, "custom message")` and asserts `name`, `code`, `message`, and `errno === undefined`.

**Operation:** Error object construction.

### 16. error with errno preserves it

Constructs `new XRootDError(3007, "io error", 5)` and asserts `errno === 5`.

**Edge case:** Optional errno parameter is preserved.

---

## Integration: XRootDUrl class

### 17–24. URL parsing and utility methods

Tests `XRootDUrl` parsing of various URL formats (full, secure, default port, with credentials), `getChannelId()`, `getLocation()`, `toString()`, `isValid()`, and static `parse()`.

**Operation:** URL parser validation against the real implementation.

---

## Integration: Protocol constants

### 25–28. Protocol version, default port, POSIX modes, credential types

Asserts `PROTOCOL_VERSION === 0x520`, `DEFAULT_PORT === 1094`, `S_IFDIR === 0o040000`, `S_IFLNK === 0o120000`, and `CRED_TYPE` maps for host/sss/unix/krb5/gsi.

**Operation:** Core protocol constant validation.
