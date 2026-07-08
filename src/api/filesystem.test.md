# filesystem.test.ts — FileSystem Unit Tests

Source: `src/api/filesystem.test.ts`

Module under test: `FileSystem` — High-level XRootD filesystem operations (stat, readdir, mkdir, rmdir, rm, mv) built on top of the `Multiplexer`.

Helper: `MockTransport` simulates transport responses by matching stream IDs.

---

## stat

### 1. returns stat info for existing file

Sends `fs.stat("/test/file.txt")`, simulates a response with body `"12345 1024 0 1700000000 1700000001 1700000002 100644 root root"`. Asserts:
- `info.id === "12345"`
- `info.size === 1024n`
- `info.mtime === 1700000000`
- `info.isDirectory === false`

**Operation:** Parses the XRootD stat response format (space-separated fields).

### 2. parses directory flag correctly

Sends `fs.stat("/test/dir")`, simulates a response with mode `040755` (directory). Asserts `info.isDirectory === true`.

**Edge case:** Directory detection via the mode field's file type bits.

### 3. throws XRootDError for not found

Sends `fs.stat("/nonexistent")`, simulates a `4003` error response with errnum 3011. Asserts the promise is rejected with `err.code === 3011`.

**Error case:** Server returns "not found" error.

---

## readdir

### 4. returns directory listing

Sends `fs.readdir("/test")`, simulates a response with dirlist entries (`".\n0 0 0 0\nfile1.txt\n0 100 0 1700000000\nfile2.txt\n0 200 0 1700000001\n"`). Asserts:
- `result.name === "/test"`
- `result.entries.length === 2`
- First entry: `name === "file1.txt"`, `size === 100`
- Second entry: `name === "file2.txt"`, `size === 200`

**Operation:** Parses the XRootD directory listing format with stat info per entry.

### 5. throws XRootDError for permission denied

Sends `fs.readdir("/restricted")`, simulates a `4003` error with errnum 3010. Asserts rejection with `err.code === 3010`.

**Error case:** Server returns "not authorized" error.

---

## mkdir

### 6. creates directory successfully

Sends `fs.mkdir("/new/dir")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — directory creation succeeds.

### 7. throws XRootDError for existing directory

Sends `fs.mkdir("/existing")`, simulates a `4003` error with errnum 3018. Asserts rejection with `err.code === 3018`.

**Error case:** Server returns "file already exists" error.

---

## rmdir

### 8. removes directory successfully

Sends `fs.rmdir("/old/dir")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — directory removal succeeds.

### 9. throws XRootDError for non-empty directory

Sends `fs.rmdir("/nonempty")`, simulates a `4003` error with errnum 3005. Asserts rejection with `err.code === 3005`.

**Error case:** Server returns "FS error" (directory not empty).

---

## rm

### 10. removes file successfully

Sends `fs.rm("/file/to/delete")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — file removal succeeds.

### 11. throws XRootDError for not found

Sends `fs.rm("/nonexistent")`, simulates a `4003` error with errnum 3011. Asserts rejection with `err.code === 3011`.

**Error case:** Server returns "not found" error.

---

## mv

### 12. moves file successfully

Sends `fs.mv("/old/path", "/new/path")`, simulates a `0` (success) response. Asserts the promise resolves without error.

**Operation:** Happy path — file rename/move succeeds.

### 13. throws XRootDError for not found source

Sends `fs.mv("/nonexistent", "/new/path")`, simulates a `4003` error with errnum 3011. Asserts rejection with `err.code === 3011`.

**Error case:** Server returns "not found" error for the source path.
