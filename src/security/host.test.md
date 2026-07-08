# host.test.ts — HostAuth Unit Tests

Source: `src/security/host.test.ts`

Module under test: `HostAuth` — Host-based authentication protocol. Returns the client's hostname as credentials.

---

## 1. has correct name — ✅ 保留

Asserts `auth.name === "host"`.

**Operation:** Protocol identifier check.

## 2. returns hostname as credentials — ⚠️ 有错误需要修改（源码 Bug）

Calls `auth.getCredentials(params)` with `host: "testhost.example.com"` and asserts the decoded credentials equal `"testhost.example.com"`.

**问题：** 当前源码 `host.ts:11` 硬编码返回 `TextEncoder().encode("host\0")`，完全忽略 `params.host`。测试描述反映了预期的正确行为（与 C++ `XrdSechost` 模块一致，发送 `"host\0" + hostname`），但实际源码不会通过此测试。**需要修改源码**：`getCredentials` 应返回 `"host\0" + params.host`。

C++ 参考（`XrdSecunix/XrdSecunix.hh` 和 `XrdSechost`）：host auth 发送 `"host\0"` + 实际主机名，服务器端使用 `strcmp()` 匹配。

## 3. returns "unknown" when host is empty — ⚠️ 有错误需要修改（依赖源码修复）

Calls `auth.getCredentials(params)` with `host: ""` and asserts the decoded credentials equal `"unknown"`.

**问题：** 同上，当前源码不使用 `params.host`。修复源码后，当 `host=""` 时应回退到 `"unknown"`。

## 4. processChallenge marks as complete — ✅ 保留

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** Host auth is single-round; processing any challenge immediately completes.

## 5. returns correct entity — ✅ 保留

Asserts `auth.getEntity()` returns `{ prot: "host", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.

---

## 需要补充的测试

### H-1. 验证凭证中包含 NUL 终止符

测试 #2 应显式验证编码后的字节数组最后一个字节为 `0x00`（NUL）。C++ 服务器端 `PManager.Find()` 使用 `strcmp()` 匹配，NUL 终止符是必需的。

### H-2. 多次调用 getCredentials 的幂等性

验证连续调用两次 `getCredentials` 返回相同结果。

### H-3. entity.host 字段（如适用）

C++ 的 `XrdSecunix` 模块设置 `entity.host`。当前 TypeScript 的 `HostAuth` 未设置此字段。如需与 C++ 行为一致，应补充设置和测试。
