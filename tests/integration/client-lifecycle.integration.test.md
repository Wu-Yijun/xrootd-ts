# client-lifecycle.integration.test.ts — XRootDClient Lifecycle Integration Tests

Source: `tests/integration/client-lifecycle.integration.test.ts`

Tests the `XRootDClient` high-level API lifecycle: connect/close state management, filesystem wrappers (mkdir/readdir/rmdir/rm/mv), stat methods, and constructor options. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection to `XROOTD_HOST:XROOTD_PORT`.

---

## Integration: XRootDClient lifecycle

### 1. connect sets isConnected = true — ✅ 保留

Creates a `XRootDClient`, asserts `isConnected === false` before connecting. Calls `client.connect()`, asserts `isConnected === true`. Closes client.

**Operation:** Connection state transitions.

### 2. close sets isConnected = false — ✅ 保留

Creates a `XRootDClient`, connects, asserts `isConnected === true`. Calls `client.close()`, asserts `isConnected === false`.

**Operation:** Disconnection state transitions.

### 3. location returns correct URL string — ✅ 保留

Creates a `XRootDClient`, connects, asserts `client.location` is a string starting with `"root://"` and containing the host.

**Operation:** The `location` property returns the server URL.

### 4. operations after close throw Uninitialized — ✅ 保留

Creates a `XRootDClient`, connects, closes. Attempts `client.open()`. Asserts throws `XRootDError` with code 311 (Uninitialized).

**Edge case:** Operations on a closed client must fail with a clear error code.

---

## Integration: XRootDClient filesystem wrappers

### 5. mkdir → readdir verifies entry → rmdir cleans up — ✅ 保留

Uses `XRootDClient`: creates a directory with a random name, lists the parent directory and asserts the new directory is present, removes it, lists again and asserts it's gone.

**Operation:** Full directory lifecycle via the high-level client API.

### 6. rm removes a file — ✅ 保留

Uses `XRootDClient`: creates a file, writes data, closes it. Calls `client.rm(path)`. Asserts `client.stat(path)` throws `XRootDError` code 3011 (NotFound).

**Operation:** File removal via the high-level client API.

### 7. mv renames a file — ✅ 保留

Uses `XRootDClient`: creates a file at source path, moves it to destination. Asserts:
- `client.stat(src)` throws NotFound
- `client.stat(dst)` succeeds with `size > 0n`

**Operation:** File rename via the high-level client API.

---

## Integration: XRootDClient stat methods

### 8. stat returns StatInfo with expected fields — ✅ 保留

Uses `XRootDClient`: calls `client.stat(TEST_FILE_PATH)` and validates all field types:
- `id`: string
- `size`: bigint (> 0)
- `mtime`, `ctime`, `atime`: number
- `mode`: number
- `owner`, `group`: string
- `isDirectory`, `isLink`, `isOffline`, `isCached`: boolean

**Operation:** Stat via high-level client returns fully typed StatInfo.

### 9. statFilesystem returns StatInfo with expected fields — ✅ 保留

Uses `XRootDClient`: calls `client.statFilesystem(TEST_FILE_PATH)` and validates `id` (string), `size` (bigint > 0), `mtime` (number).

**Operation:** statFilesystem is an alternative stat method that returns the same type.

### 10. stat and statFilesystem return same size for same file — ✅ 保留

Uses `XRootDClient`: calls both `stat()` and `statFilesystem()` on the same file. Asserts `info1.size === info2.size`.

**Edge case:** Both stat methods should return identical size values for the same file.

---

## Integration: XRootDClient with options

### 11. timeout option: operations complete within timeout — ✅ 保留

Creates `XRootDClient` with `{ timeout: 10000 }`. Connects, stats a file, asserts success.

**Operation:** Custom timeout option is accepted and doesn't break operations.

### 12. maxRedirects option defaults to 16 — ✅ 保留

Creates `XRootDClient` with `{ maxRedirects: 16 }`. Connects, asserts connected.

**Operation:** Custom maxRedirects option is accepted.

### 13. credentials option works with no-auth server — ✅ 保留

Creates `XRootDClient` with `{ credentials: { username: "testuser" } }`. Connects, asserts connected.

**Edge case:** Credentials option is accepted even when the server doesn't require authentication.

### 14. credentials with password works with no-auth server — ✅ 保留

Creates `XRootDClient` with `{ credentials: { username: "testuser", password: "testpass" } }`. Connects, asserts connected.

**Edge case:** Full credentials (username + password) option is accepted on a no-auth server.

---

## 需要补充的测试

### ICL-1. connect 失败 — 🔴 需要添加

连接到不可达的地址，验证 `client.connect()` 正确抛出错误。

### ICL-2. 重连 — 🔴 需要添加

`client.close()` 后再 `client.connect()`，验证可以重新建立连接并执行操作。

### ICL-3. 并发操作 — 🟡 需要添加

同时执行多个 stat/read 操作，验证并发处理正确。

### ICL-4. timeout 触发 — 🔴 需要添加

使用极短超时（如 1ms），验证操作超时后正确抛出错误。

### ICL-5. open → read → close 完整流程 — 🔴 需要添加

使用 XRootDClient 执行完整的 open → read → close 流程（目前只测试了低级 API）。

### ICL-6. open → write → read → close 往返 — 🔴 需要添加

使用 XRootDClient 执行完整的写入-读取往返流程。

### ICL-7. client.stat 对目录 — 🟡 需要添加

`client.stat("/data/test")` 对目录 stat，验证 `isDirectory === true`。

### ICL-8. client.options 属性 — 🟡 验证

验证 `client.options` 返回构造时传入的选项。

### ICL-9. 多次 close — 🟡 验证

多次调用 `client.close()`，验证幂等性（不抛出错误）。
