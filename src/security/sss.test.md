# sss.test.ts — SSSAuth Unit Tests

Source: `src/security/sss.test.ts`

Module under test: `SSSAuth` — Simple Shared Secret authentication protocol. Encrypts credentials using Blowfish with an 8-byte shared key.

---

## 1. has correct name — ✅ 保留

Asserts `auth.name === "sss"`.

**Operation:** Protocol identifier check.

## 2. throws on invalid key length — ✅ 保留

Asserts that constructing `new SSSAuth(Buffer.from([0x01, 0x02]))` throws an error matching `/SSS key must be 8 bytes/`.

**Edge case:** The SSS protocol requires exactly an 8-byte key. Any other length is rejected at construction time.

## 3. isSupported() returns whether Blowfish is available — ✅ 保留

Asserts `SSSAuth.isSupported()` returns a `boolean`.

**Operation:** Runtime capability check — Blowfish may not be available in all Node.js builds.

## 4. processChallenge marks as complete — ✅ 保留

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** SSS auth is single-round; processing any challenge immediately completes.

## 5. returns correct entity — ✅ 保留

Asserts `auth.getEntity()` returns `{ prot: "sss", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.

## 6. returns encrypted credentials (conditional: Blowfish supported) — ✅ 保留

Calls `auth.getCredentials(params)` with a valid key and asserts:
- `creds.length > 0`
- `creds.length % 8 === 0` (Blowfish block size alignment)

**Operation:** Credentials are encrypted with Blowfish, producing output that is a multiple of 8 bytes.

## 7. different passwords produce different credentials (conditional) — ✅ 保留

Creates two `SSSAuth` instances with the same key, calls `getCredentials` with different passwords (`"secret"` vs `"different"`), and asserts the credential arrays differ.

**Operation:** Different passwords must produce different encrypted outputs (verifying encryption is working).

## 8. sets username in entity (conditional) — ✅ 保留

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** Entity name is populated after `getCredentials` is called.

## 9. handles empty password (conditional) — ✅ 保留

Calls `auth.getCredentials(params)` with `password: ""` and asserts:
- `creds.length > 0`
- `creds.length % 8 === 0`

**Edge case:** Empty password should still produce valid encrypted credentials without errors.

> **Note:** Tests 6–9 are conditionally skipped (with `it.skip`) when Blowfish is not supported in the Node.js runtime.

---

## 需要补充的测试

### S-1. 构造函数 key 长度边界

- key 长度为 0 → 应抛出错误
- key 长度为 9 → 应抛出错误
- key 恰好为 8 字节 → 不抛出（隐含在其他测试中，但无专门断言）

### S-2. 密文确定性验证

相同 key + 相同 password 多次调用 `getCredentials` 应产生相同密文（Blowfish-ECB 是确定性加密）。

### S-3. CRC32 正确性验证

使用已知的测试向量验证 `crc32` 输出。例如：对空字符串 `""` 的 CRC32 应为 `0x00000000`，对 `"hello"` 的 CRC32 可用独立实现验证。

### S-4. PKCS5 填充验证

验证 `getCredentials` 的中间 payload（password + CRC32）被正确填充到 8 字节对齐。例如：1 字节 password → payload 为 5 字节（1+4）→ 填充到 8 字节。

### S-5. 加密算法验证

验证输出确实是 Blowfish-ECB 加密（可使用参考实现解密并验证明文匹配 password + CRC32）。

### S-6. null/undefined password 处理

源码使用 `params.password || ""`，验证 `password: undefined` 和 `password: null` 的情况（应与空字符串等价）。
