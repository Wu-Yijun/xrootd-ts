# client-lifecycle.integration.test.ts — XRootDClient Lifecycle Integration Tests

Source: `tests/integration/client-lifecycle.integration.test.ts`

Tests the `XRootDClient` high-level API lifecycle: connect/close state management, filesystem wrappers (mkdir/readdir/rmdir/rm/mv), stat methods, and constructor options. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection to `XROOTD_HOST:XROOTD_PORT`.

---

## Integration: XRootDClient lifecycle

### 1. connect sets isConnected = true

Creates a `XRootDClient`, asserts `isConnected === false` before connecting. Calls `client.connect()`, asserts `isConnected === true`. Closes client.

**Operation:** Connection state transitions.

### 2. close sets isConnected = false

Creates a `XRootDClient`, connects, asserts `isConnected === true`. Calls `client.close()`, asserts `isConnected === false`.

**Operation:** Disconnection state transitions.

### 3. location returns correct URL string

Creates a `XRootDClient`, connects, asserts `client.location` is a string starting with `"root://"` and containing the host.

**Operation:** The `location` property returns the server URL.

### 4. operations after close throw Uninitialized

Creates a `XRootDClient`, connects, closes. Attempts `client.open()`. Asserts throws `XRootDError` with code 311 (Uninitialized).

**Edge case:** Operations on a closed client must fail with a clear error code.

---

## Integration: XRootDClient filesystem wrappers

### 5. mkdir → readdir verifies entry → rmdir cleans up

Uses `XRootDClient`: creates a directory with a random name, lists the parent directory and asserts the new directory is present, removes it, lists again and asserts it's gone.

**Operation:** Full directory lifecycle via the high-level client API.

### 6. rm removes a file

Uses `XRootDClient`: creates a file, writes data, closes it. Calls `client.rm(path)`. Asserts `client.stat(path)` throws `XRootDError` code 3011 (NotFound).

**Operation:** File removal via the high-level client API.

### 7. mv renames a file

Uses `XRootDClient`: creates a file at source path, moves it to destination. Asserts:
- `client.stat(src)` throws NotFound
- `client.stat(dst)` succeeds with `size > 0n`

**Operation:** File rename via the high-level client API.

---

## Integration: XRootDClient stat methods

### 8. stat returns StatInfo with expected fields

Uses `XRootDClient`: calls `client.stat(TEST_FILE_PATH)` and validates all field types:
- `id`: string
- `size`: bigint (> 0)
- `mtime`, `ctime`, `atime`: number
- `mode`: number
- `owner`, `group`: string
- `isDirectory`, `isLink`, `isOffline`, `isCached`: boolean

**Operation:** Stat via high-level client returns fully typed StatInfo.

### 9. statFilesystem returns StatInfo with expected fields

Uses `XRootDClient`: calls `client.statFilesystem(TEST_FILE_PATH)` and validates `id` (string), `size` (bigint > 0), `mtime` (number).

**Operation:** statFilesystem is an alternative stat method that returns the same type.

### 10. stat and statFilesystem return same size for same file

Uses `XRootDClient`: calls both `stat()` and `statFilesystem()` on the same file. Asserts `info1.size === info2.size`.

**Edge case:** Both stat methods should return identical size values for the same file.

---

## Integration: XRootDClient with options

### 11. timeout option: operations complete within timeout

Creates `XRootDClient` with `{ timeout: 10000 }`. Connects, stats a file, asserts success.

**Operation:** Custom timeout option is accepted and doesn't break operations.

### 12. maxRedirects option defaults to 16

Creates `XRootDClient` with `{ maxRedirects: 16 }`. Connects, asserts connected.

**Operation:** Custom maxRedirects option is accepted.

### 13. credentials option works with no-auth server

Creates `XRootDClient` with `{ credentials: { username: "testuser" } }`. Connects, asserts connected.

**Edge case:** Credentials option is accepted even when the server doesn't require authentication.

### 14. credentials with password works with no-auth server

Creates `XRootDClient` with `{ credentials: { username: "testuser", password: "testpass" } }`. Connects, asserts connected.

**Edge case:** Full credentials (username + password) option is accepted on a no-auth server.
