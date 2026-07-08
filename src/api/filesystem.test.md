# filesystem.test.ts — FileSystem Unit Tests

Source: `src/api/filesystem.test.ts`

Module under test: `FileSystem` — High-level XRootD filesystem operations (stat, readdir, mkdir, rmdir, rm, mv) built on top of the `Multiplexer`.

Helper: `MockTransport` simulates transport responses by matching stream IDs.

---

## stat

### 1. returns stat info for existing file — ✅ 保留

Sends `fs.stat("/test/file.txt")`, simulates a response with body `"12345 1024 0 1700000000 1700000001 1700000002 100644 root root"`. Asserts:
- `info.id === "12345"`
- `info.size === 1024n`
- `info.mtime === 1700000000`
- `info.isDirectory === false`

**Operation:** Parses the XRootD stat response format (space-separated fields).

### 2. parses directory flag correctly — ✅ 保留

Sends `fs.stat("/test/dir")`, simulates a response with mode `040755` (directory). Asserts `info.isDirectory === true`.

**Edge case:** Directory detection via the mode field's file type bits.

### 3. throws XRootDError for not found — ✅ 保留

Sends `fs.stat("/nonexistent")`, simulates a `4003` error response with errnum 3011. Asserts the promise is rejected with `err.code === 3011`.

**Error case:** Server returns "not found" error.

---

## readdir

### 4. returns directory listing — ✅ 保留

Sends `fs.readdir("/test")`, simulates a response with dirlist entries (`".\n0 0 0 0\nfile1.txt\n0 100 0 1700000000\nfile2.txt\n0 200 0 1700000001\n"`). Asserts:
- `result.name === "/test"`
- `result.entries.length === 2`
- First entry: `name === "file1.txt"`, `size === 100`
- Second entry: `name === "file2.txt"`, `size === 200`

**Operation:** Parses the XRootD directory listing format with stat info per entry.

### 5. throws XRootDError for permission denied — ✅ 保留

Sends `fs.readdir("/restricted")`, simulates a `4003` error with errnum 3010. Asserts rejection with `err.code === 3010`.

**Error case:** Server returns "not authorized" error.

---

## mkdir

### 6. creates directory successfully — ✅ 保留

Sends `fs.mkdir("/new/dir")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — directory creation succeeds.

### 7. throws XRootDError for existing directory — ✅ 保留

Sends `fs.mkdir("/existing")`, simulates a `4003` error with errnum 3018. Asserts rejection with `err.code === 3018`.

**Error case:** Server returns "file already exists" error.

---

## rmdir

### 8. removes directory successfully — ✅ 保留

Sends `fs.rmdir("/old/dir")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — directory removal succeeds.

### 9. throws XRootDError for non-empty directory — ✅ 保留

Sends `fs.rmdir("/nonempty")`, simulates a `4003` error with errnum 3005. Asserts rejection with `err.code === 3005`.

**Error case:** Server returns "FS error" (directory not empty).

---

## rm

### 10. removes file successfully — ✅ 保留

Sends `fs.rm("/file/to/delete")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — file removal succeeds.

### 11. throws XRootDError for not found — ✅ 保留

Sends `fs.rm("/nonexistent")`, simulates a `4003` error with errnum 3011. Asserts rejection with `err.code === 3011`.

**Error case:** Server returns "not found" error.

---

## mv

### 12. moves file successfully — ✅ 保留

Sends `fs.mv("/old/path", "/new/path")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — file rename/move succeeds.

### 13. throws XRootDError for not found source — ✅ 保留

Sends `fs.mv("/nonexistent", "/new/path")`, simulates a `4003` error with errnum 3011. Asserts rejection with `err.code === 3011`.

**Error case:** Server returns "not found" error for the source path.

---

## 需要补充的测试

### FS-1. readdir 的 dstat 选项 — 🟡 需要添加

`filesystem.ts:35` — `options?.dstat ? DirlistOptions.Dstat : 0`。当 `dstat: true` 时，`buildDirlistRequest` 的 options 字节应为 2（`DirlistOptions.Dstat`）。验证请求中的 options 字段。

### FS-2. mkdir 自定义 mode — 🟡 需要添加

`filesystem.ts:44` — `mode: number = DEFAULT_DIR_MODE`。传入自定义 mode（如 `0o755`），验证请求中的 mode 字段。

### FS-3. readdir 空目录

模拟空目录响应（仅 `".\n0 0 0 0\n"` 前缀，无条目），验证返回 `entries.length === 0`。

### FS-4. readdir 名称格式（无 dstat）

模拟纯名称格式的 dirlist 响应（`"file1\nfile2\n"`），验证正确解析。

### FS-5. 构造函数 getMux 模式

`filesystem.ts:20` — 构造函数接受 `getMux: () => Multiplexer`。当前测试直接传入 `mux`（可能因 TypeScript 宽松匹配而未报错）。验证传入 `() => mux` 函数形式是否正确工作。

### FS-6. getMux() 抛出异常

验证当 `getMux()` 返回的 mux 无效时，操作能正确传播错误。
