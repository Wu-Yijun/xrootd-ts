# loader.test.ts — loadAuthConfig Unit Tests

Source: `src/config/loader.test.ts`

Module under test: `loadAuthConfig()` — Loads authentication configuration by merging credentials from multiple sources (options, URL userinfo, SecEnv, SSS keytab file) with a defined priority order.

---

## 1. returns empty config with no inputs — ✅ 保留

Calls `loadAuthConfig({})` with no arguments. Asserts `username`, `password`, and `sssKey` are all `undefined`.

**Operation:** Empty input produces empty config.

## 2. prefers credentials over URL — ✅ 保留

Provides both a URL with credentials (`root://urluser:urlpass@host/path`) and an explicit `credentials` option (`{ username: "optuser", password: "optpass" }`). Asserts the explicit credentials win: `username === "optuser"`, `password === "optpass"`.

**Edge case:** Explicit `credentials` option has higher priority than URL userinfo.

## 3. falls back to URL userinfo — ✅ 保留

Provides only a URL with credentials (`root://urluser:urlpass@host/path`). Asserts `username === "urluser"`, `password === "urlpass"`.

**Operation:** When no explicit credentials are provided, URL userinfo is used.

## 4. falls back to SecEnv XrdSecUSER/XrdSecCREDS — ✅ 保留

Provides a `SecEnv` with `XrdSecUSER: "envuser"` and `XrdSecCREDS: "envpass"`. Asserts `username === "envuser"`, `password === "envpass"`.

**Operation:** When no URL or explicit credentials are provided, SecEnv variables are used.

## 5. reads SSS keytab file when available — ✅ 保留

Creates a temporary file with 8 bytes of key data, sets `XrdSecSSSKT` to point to it. Asserts `sssKey` is a `Uint8Array` of length 8 matching the file contents.

**Operation:** SSS keytab file is read from disk when the path is provided via SecEnv.

## 6. returns undefined sssKey when keytab file does not exist — ✅ 保留

Sets `XrdSecSSSKT` to `/nonexistent/path/key`. Asserts `sssKey === undefined`.

**Edge case:** Missing keytab file does not throw — it gracefully returns `undefined`.

## 7. username/password defaults to undefined when all sources empty — ✅ 保留

Provides a URL without userinfo (`root://host/path`) and no other sources. Asserts `username === undefined` and `password === undefined`.

**Edge case:** When all credential sources are empty, the result fields are `undefined` rather than empty strings.

---

## 需要补充的测试

### L-1. krb5Principal 构建 — 🔴 需要添加

`loader.ts:42-44` 中的 Kerberos 主体构建逻辑完全未测试。测试用例：
- `secEnv.krb5InitToken = true` + `username = "alice"` + `url.host = "cern.ch"` → `krb5Principal === "alice@cern.ch"`
- `secEnv.krb5InitToken = true` + `username = undefined` → `krb5Principal === undefined`
- `secEnv.krb5InitToken = true` + `username = "alice"` + 无 URL → `krb5Principal === "alice@unknown"`（回退到 `"unknown"`）
- `secEnv.krb5InitToken = false` → `krb5Principal === undefined`

### L-2. 三个来源同时提供

同时提供 `url`、`credentials` 和 `secEnv`，验证完整的优先级链：`credentials > url > secEnv`。

### L-3. 仅提供 username 无 password

`credentials: { username: "only_user" }`（无 password），验证 password 从下一个来源（url 或 secEnv）回退。

### L-4. SSS keytab + credentials 同时存在

验证 SSS keytab 读取与 username/password 解析独立工作。

### L-5. readFileSync 权限错误

模拟 `readFileSync` 抛出非 ENOENT 错误（如 EACCES），验证 catch 块静默处理（`sssKey = undefined`）。
