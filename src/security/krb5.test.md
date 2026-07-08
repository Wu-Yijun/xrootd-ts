# krb5.test.ts — Krb5Auth Unit Tests

Source: `src/security/krb5.test.ts`

Module under test: `Krb5Auth` — Kerberos 5 authentication protocol. Obtains a Kerberos ticket and returns it as credentials prefixed with `"krb5"`.

---

## 1. has correct name — ✅ 保留

Asserts `auth.name === "krb5"`.

**Operation:** Protocol identifier check.

## 2. isSupported() returns whether kerberos package is available — ✅ 保留

Asserts `Krb5Auth.isSupported()` returns a `boolean`.

**Operation:** Runtime capability check — the `kerberos` npm package may not be installed.

## 3. processChallenge marks as complete — ✅ 保留

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** Krb5 auth is single-round; processing any challenge immediately completes.

## 4. returns correct entity — ✅ 保留

Asserts `auth.getEntity()` returns `{ prot: "krb5", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.

## 5. returns credentials with krb5 prefix (conditional: Kerberos available) — ✅ 保留

Calls `auth.getCredentials(params)` and decodes the first 4 bytes. Asserts they equal `"krb5"`.

**Operation:** Credentials must be prefixed with the protocol identifier string.

## 6. credentials include kerberos token (conditional) — ✅ 保留

Calls `auth.getCredentials(params)` and asserts `creds.length > 4` (prefix + actual token).

**Operation:** Kerberos credentials contain more than just the 4-byte prefix.

## 7. sets username in entity after getCredentials (conditional) — ✅ 保留

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** Entity name is populated after `getCredentials` is called.

> **Note:** Tests 5–7 are conditionally skipped (with `it.skip`) when the Kerberos package is not available.

---

## 需要补充的测试

### K-1. 凭证格式验证：`"krb5\0" + AP-REQ`

源码 `krb5.ts:68` 构建 `"krb5\0"` 前缀（5 字节），然后追加 AP-REQ。测试 #5 仅检查前 4 字节（`"krb5"`），未验证第 5 字节为 NUL (`0x00`)。应显式验证：
- `creds[4] === 0x00`（NUL 终止符）
- NUL 之后的数据为有效的 Kerberos AP-REQ

### K-2. spnPrefix 回退逻辑

当 `params.spnPrefix` 未设置时，源码 `krb5.ts:47` 回退到 `"xrootd"`。验证：
- `getCredentials({..., spnPrefix: undefined})` → SPN 使用 `"xrootd@<host>"`
- `getCredentials({..., spnPrefix: "host"})` → SPN 使用 `"host@<host>"`

### K-3. SPN 格式验证

验证构造的 SPN 格式为 `${servicePrefix}@${params.host}`。可通过 mock `kerberos.initializeClient` 来捕获传入的 SPN 参数。

### K-4. kerberos 模块加载失败处理

当 `kerberos` 模块不可用时（`isSupported() === false`），调用 `getCredentials` 应抛出有意义的错误。当前有条件测试在 `isSupported() === false` 时跳过，但未验证错误消息。

### K-5. extractApReq 集成验证

`extractApReq()` 从 GSS-API InitialContextToken 中提取原始 AP-REQ。这是一个安全敏感的 ASN.1 解析操作。应验证：
- 输入以 `0x60` 开头的 GSS-API token → 输出以 `0x6e` 开头的 AP-REQ
- AP-REQ 长度 < 输入 token 长度（GSS-API framing 被剥离）

### K-6. 错误处理：kerberosClient.step() 失败

当 `kerberosClient.step("")` 抛出异常时（如 Kerberos 票据过期），错误应正确传播。

### K-7. loadKerberos 缓存行为

验证多次调用 `loadKerberos()` 时复用已加载的模块（不会重复 `import("kerberos")`）。
