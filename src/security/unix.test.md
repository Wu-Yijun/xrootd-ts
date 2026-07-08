# unix.test.ts — UnixAuth Unit Tests

Source: `src/security/unix.test.ts`

Module under test: `UnixAuth` — Unix socket-based authentication protocol. Returns credentials in the format `unix\0<username> <group>`.

---

## 1. has correct name — ✅ 保留

Asserts `auth.name === "unix"`.

**Operation:** Protocol identifier check.

## 2. returns credentials with unix prefix — ✅ 保留

Calls `auth.getCredentials(params)` and decodes the result. Asserts the decoded string starts with `"unix\0"`.

**Operation:** The credential format must begin with the null-terminated protocol identifier.

## 3. includes username and group in credentials — ✅ 保留

Calls `auth.getCredentials(params)` with `username: "testuser"`. Asserts the decoded credentials contain `"testuser"`.

**Operation:** The username from auth params is embedded in the credential payload.

## 4. uses provided username — ✅ 保留

Calls `auth.getCredentials(params)` with `username: "alice"`. Asserts the decoded credentials contain `"alice"`.

**Operation:** Different usernames produce different credential payloads.

## 5. falls back to unknown when no username — ✅ 保留

Calls `auth.getCredentials(params)` with `username: undefined`. Asserts the decoded string still starts with `"unix\0"`.

**Edge case:** When no username is provided, the credential is still well-formed (uses a fallback).

## 6. processChallenge marks as complete — ✅ 保留

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and the response has length 0.

**Operation:** After processing any challenge, the Unix auth protocol is immediately complete (single round).

## 7. returns correct entity — ✅ 保留

Asserts `auth.getEntity()` returns `{ prot: "unix", uid: 0, gid: 0 }`.

**Operation:** The security entity has the correct protocol name and default uid/gid values.

## 8. sets username in entity after getCredentials — ✅ 保留

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** The entity's `name` field is populated after `getCredentials` is called, not before.

---

## 需要补充的测试

### U-1. 凭证格式精确验证

验证完整的凭证格式为 `"unix\0" + username + " " + group`。当前测试仅检查包含 username，未验证：
- 空格分隔符存在于 username 和 group 之间
- group 值（来自 `process.env.GROUP || process.env.LOGNAME || "unknown"`）

### U-2. entity.host 字段

源码 `unix.ts:34` 设置 `this.entity.host = hostname()`，但测试从未断言此字段。验证 `auth.getEntity().host === os.hostname()`。

### U-3. 环境变量回退链

当前测试未操纵环境变量。应测试：
- 设置 `process.env.USER = "envuser"`，不传 `username` → 验证使用 `"envuser"`
- 设置 `process.env.LOGNAME = "loguser"`，不设 `USER` → 验证使用 `"loguser"`
- 两者都不设 → 验证使用 `"unknown"`

### U-4. group 环境变量

验证 group 的回退链：`process.env.GROUP` → `process.env.LOGNAME` → `"unknown"`。

### U-5. NUL 终止符验证

显式验证 `"unix\0"` 前缀的第 5 个字节为 `0x00`。
