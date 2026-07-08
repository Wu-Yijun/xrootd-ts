# filesystem-mutate.integration.test.ts — FileSystem Mutating Operations Integration Tests

Source: `tests/integration/filesystem-mutate.integration.test.ts`

Tests mutating `FileSystem` operations (`mkdir`, `rmdir`, `rm`, `mv`) against a real XRootD server. Each test uses unique random paths to avoid conflicts between parallel runs. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection. Uses `createConnectedLowLevel()` for transport/mux/session and `randomTestId()` for unique path generation.

---

## Integration: FileSystem.mkdir

### 1. mkdir creates a new directory — ✅ 保留

Creates a directory with a random name, then asserts `fs.stat(dirPath).isDirectory === true`.

**Operation:** Happy path — mkdir creates a directory that is stat-verified.

### 2. mkdir on existing path with different mode throws 3018 — ✅ 保留

Creates a directory with mode `0o700`, then attempts to create the same path with mode `0o755`. Asserts the second call throws `XRootDError` with code 3018 (ItExists).

**Edge case:** XRootD considers mkdir with a different mode as a conflict, even though the directory already exists. This is server-specific behavior.

### 3. mkdir on existing path with same mode succeeds (idempotent) — ✅ 保留

Creates a directory with mode `0o755`, then creates the same path with the same mode `0o755`. Asserts no error.

**Edge case:** Mkdir is idempotent when the mode matches — creating an already-existing directory with the same permissions succeeds.

### 4. mkdir with custom mode — ✅ 保留

Creates a directory with mode `0o755`, then asserts `stat` shows `isDirectory === true`.

**Operation:** Custom mode parameter is accepted by the server.

---

## Integration: FileSystem.rmdir

### 5. rmdir removes an empty directory — ✅ 保留

Creates a directory, verifies it exists via stat, removes it, then asserts stat throws `XRootDError` code 3011 (NotFound).

**Operation:** Happy path — rmdir removes an empty directory and it's gone.

### 6. rmdir on non-existent path succeeds (idempotent) — ✅ 保留

Attempts to remove a non-existent directory. Asserts no error.

**Edge case:** XRootD rmdir is idempotent — removing a non-existent directory does not fail.

---

## Integration: FileSystem.rm

### 7. rm removes an existing file — ✅ 保留

Creates a file with `File.open/write/close`, verifies it exists via stat, removes it with `fs.rm()`, then asserts stat throws `XRootDError` code 3011 (NotFound).

**Operation:** Happy path — rm deletes a file and it's gone.

### 8. rm on non-existent path throws XRootDError code 3011 — ✅ 保留

Attempts to remove a non-existent file. Asserts throws `XRootDError` with code 3011.

**Error case:** Unlike rmdir, rm on a non-existent file is NOT idempotent — it throws NotFound.

---

## Integration: FileSystem.mv

### 1. mv renames a file — ✅ 保留

Creates a file at `srcPath`, moves it to `dstPath`, asserts:
- `stat(srcPath)` throws NotFound (source gone)
- `stat(dstPath)` succeeds with `size > 0n` (destination exists)

**Operation:** Happy path — mv atomically renames a file.

### 2. mv on non-existent source throws XRootDError code 3011 — ✅ 保留

Attempts to move a non-existent source file. Asserts throws `XRootDError` with code 3011.

**Error case:** Server returns NotFound for the source path.

---

## Integration: FileSystem.readdir edge cases

### 3. readdir on non-existent path throws error — ✅ 保留

Attempts to list a non-existent directory. Asserts throws `XRootDError`.

**Error case:** Server returns an error for a non-existent directory path.

### 4. readdir entries have correct fields (name, size, flags, mtime) — ✅ 保留

Lists the test write directory and validates each entry has the correct field types.

**Operation:** Type validation of directory entries from the write directory.

---

## 需要补充的测试

### IFM-1. mv 目标父目录不存在 — 🔴 需要添加

mv 到不存在的目标父目录，验证服务器返回错误。

### IFM-2. mv 覆盖已存在的目标 — 🔴 需要添加

mv 到一个已存在的目标文件，验证行为（覆盖或报错，取决于服务器实现）。

### IFM-3. rm 目录 — 🔴 需要添加

对目录调用 rm，验证服务器返回 "Is a dir" 错误（3016）。

### IFM-4. 嵌套 mkdir — 🟡 需要添加

创建深层路径 `/data/a/b/c`，验证嵌套目录创建。

### IFM-5. rmdir 非空目录 — 🔴 需要添加

rmdir 非空目录，验证服务器返回 "Dir not empty" 错误（3015）。

### IFM-6. mkdir 权限错误 — 🟡 需要添加

在只读服务器上尝试 mkdir，验证返回 3010 (NotAuthorized) 错误。
