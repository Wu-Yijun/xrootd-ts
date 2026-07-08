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

## 1. mkdir → readdir → mv → rm → rmdir

**Flow — Full directory lifecycle:**
1. **mkdir**: Creates `/data/test/newdir` → asserts success.
2. **readdir**: Lists `/data/test` → asserts `newdir` appears in the listing.
3. **mv**: Renames `/data/test/newdir` to `/data/test/renameddir` → asserts success.
4. **readdir**: Lists `/data/test` → asserts `renameddir` is present and `newdir` is absent.
5. **rmdir**: Removes `/data/test/renameddir` → asserts success.
6. **readdir**: Lists `/data/test` → asserts `renameddir` is absent.

**Operation:** Complete directory lifecycle — create, list, rename, remove, verify at each step.

## 2. mkdir on existing directory throws

Attempts `fs.mkdir("/data/test")` where `/data/test` already exists. Asserts the promise rejects with an error.

**Error case:** Server returns "It exists" (errnum 3014) for duplicate directory creation.

## 3. rmdir on non-empty directory throws

Attempts `fs.rmdir("/data/test")` which contains `file.txt`. Asserts the promise rejects with an error.

**Error case:** Server returns "Dir not empty" (errnum 3015) for non-empty directory removal.

## 4. rm on non-existent file throws

Attempts `fs.rm("/data/test/nonexistent.txt")` which does not exist. Asserts the promise rejects with an error.

**Error case:** Server returns "No such file" (errnum 3011) for removal of non-existent file.

## 5. rm file succeeds

Removes `/data/test/file.txt` which exists. Asserts success. Then lists `/data/test` and asserts `file.txt` is no longer present.

**Operation:** Happy path — file removal succeeds and is verified via directory listing.
