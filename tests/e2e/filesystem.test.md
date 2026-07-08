# filesystem.test.ts — E2E FileSystem Lifecycle Tests

Source: `tests/e2e/filesystem.test.ts`

Tests the `FileSystem` high-level API against a simulated XRootD server with an in-memory virtual filesystem. The server implements `kXR_stat`, `kXR_dirlist`, `kXR_mkdir`, `kXR_rmdir`, `kXR_rm`, and `kXR_mv` operations.

Infrastructure: `createFileSystemServer()` creates a real TCP server with an in-memory directory tree:
```
/
  data/
    test/
      file.txt
```

Helper: `setupSession(port)` performs protocol + login handshake and returns a ready-to-use `FileSystem` instance.

---

## 1. mkdir → readdir → mv → rm → rmdir — ✅ 保留

**Flow — Full directory lifecycle:**
1. **mkdir**: Creates `/data/test/newdir` → asserts success.
2. **readdir**: Lists `/data/test` → asserts `newdir` appears in the listing.
3. **mv**: Renames `/data/test/newdir` to `/data/test/renameddir` → asserts success.
4. **readdir**: Lists `/data/test` → asserts `renameddir` is present and `newdir` is absent.
5. **rmdir**: Removes `/data/test/renameddir` → asserts success.
6. **readdir**: Lists `/data/test` → asserts `renameddir` is absent.

**Operation:** Complete directory lifecycle — create, list, rename, remove, verify at each step.

## 2. mkdir on existing directory throws — ✅ 保留

Attempts `fs.mkdir("/data/test")` where `/data/test` already exists. Asserts the promise rejects with an error.

**Error case:** Server returns "It exists" (errnum 3014) for duplicate directory creation.

## 3. rmdir on non-empty directory throws — ✅ 保留

Attempts `fs.rmdir("/data/test")` which contains `file.txt`. Asserts the promise rejects with an error.

**Error case:** Server returns "Dir not empty" (errnum 3015) for non-empty directory removal.

## 4. rm on non-existent file throws — ✅ 保留

Attempts `fs.rm("/data/test/nonexistent.txt")` which does not exist. Asserts the promise rejects with an error.

**Error case:** Server returns "No such file" (errnum 3011) for removal of non-existent file.

## 5. rm file succeeds — ✅ 保留

Removes `/data/test/file.txt` which exists. Asserts success. Then lists `/data/test` and asserts `file.txt` is no longer present.

**Operation:** Happy path — file removal succeeds and is verified via directory listing.

---

## 需要补充的测试

### FS-1. FileSystem.stat() — 🔴 需要添加

`FileSystem.stat()` 方法存在但无 E2E 测试。测试 stat 已存在文件和不存在文件。

### FS-2. readdir 带 dstat 选项 — 🔴 需要添加

`readdir(path, { dstat: true })` 返回扩展 stat 信息。服务器应返回包含 stat 信息的目录列表。

### FS-3. mv 目标父目录不存在 — 🔴 需要添加

mv 到一个不存在的目标父目录，验证服务器返回错误。

### FS-4. mv 源不存在 — 🔴 需要添加

mv 一个不存在的源路径，验证服务器返回错误。

### FS-5. rm 目录（非文件） — 🔴 需要添加

对目录调用 rm，服务器应返回 "Is a dir" 错误（errnum 3016）。

### FS-6. mkdir 带自定义 mode — 🔴 需要添加

`mkdir(path, mode)` 传入非默认 mode，验证 mode 被正确传递。

### FS-7. 嵌套 mkdir — 🟡 需要添加

创建深层路径 `/data/a/b/c`，验证服务器处理嵌套目录创建。

### FS-8. readdir 不存在的目录 — 🔴 需要添加

readdir 一个不存在的目录，验证服务器返回 3011 错误。

### FS-9. readdir 根目录 — 🟡 需要添加

readdir `/` 根目录，验证返回顶级目录列表。

### FS-10. stat 不存在的路径 — 🔴 需要添加

stat 一个不存在的路径，验证返回 3011 错误。
