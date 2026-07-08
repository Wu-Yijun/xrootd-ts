# sec-env.test.ts — SecEnv Unit Tests

Source: `src/config/sec-env.test.ts`

Module under test: `SecEnv` — Security environment configuration that parses XRootD security-related environment variables (`XrdSec*`, `X509_*`) into a structured config object.

---

## 1. returns empty defaults with empty env — ✅ 保留

Creates `SecEnv` with an empty environment object. Asserts all fields have default values:
- `protocolFilter = []`
- `proxyMode = false`, `proxyCreds = false`
- `sssKeytab = undefined`, `krb5InitToken = false`
- `username = undefined`, `password = undefined`

**Operation:** Default state when no environment variables are set.

## 2. parses XrdSecPROTOCOL into protocolFilter — ✅ 保留

Parses `XrdSecPROTOCOL: "host, sss , gsi"`. Asserts `protocolFilter === ["host", "sss", "gsi"]`.

**Operation:** Comma-separated protocol list with whitespace trimming.

## 3. parses XrdSecPROXY and XrdSecPROXYCREDS — ✅ 保留

Parses `XrdSecPROXY: "1", XrdSecPROXYCREDS: "1"`. Asserts `proxyMode === true` and `proxyCreds === true`.

**Operation:** Boolean-like env vars parsed as true when value is `"1"`.

## 4. treats XrdSecPROXY=0 as false — ✅ 保留

Parses `XrdSecPROXY: "0"`. Asserts `proxyMode === false`.

**Edge case:** Value `"0"` is treated as false, not truthy.

## 5. parses SSS keytab from XrdSecSSSKT — ✅ 保留

Parses `XrdSecSSSKT: "/etc/xrootd/sss.key"`. Asserts `sssKeytab === "/etc/xrootd/sss.key"`.

**Operation:** SSS keytab path extraction.

## 6. falls back to XrdSecsssKT for SSS keytab — ✅ 保留

Parses `XrdSecsssKT: "/legacy/key.tab"`. Asserts `sssKeytab === "/legacy/key.tab"`.

**Edge case:** Legacy env var name `XrdSecsssKT` is supported as a fallback for `XrdSecSSSKT`.

## 7. disables SSS when sss=false — ✅ 保留

Parses `XrdSecSSSKT: "/etc/xrootd/sss.key"` with option `sss: false`. Asserts `sssKeytab === undefined`.

**Edge case:** Even if the env var is set, `sss: false` option clears the keytab.

## 8. parses KRB5 init token — ✅ 保留

Parses `XrdSecKRB5INITTKN: "1"`. Asserts `krb5InitToken === true`.

**Operation:** Kerberos init token flag parsing.

## 9. disables KRB5 when krb5=false — ✅ 保留

Parses `XrdSecKRB5INITTKN: "1"` with option `krb5: false`. Asserts `krb5InitToken === false`.

**Edge case:** The `krb5: false` option overrides the env var.

## 10. parses GSI variables with XrdSecGSI* prefix — ✅ 保留

Parses `XrdSecGSICADIR`, `XrdSecGSICRLDIR`, `XrdSecGSIUSERCERT`, `XrdSecGSIUSERKEY`, `XrdSecGSIUSERPROXY`. Asserts all five `gsi*` fields are set correctly.

**Operation:** GSI (Grid Security Infrastructure) configuration from `XrdSecGSI*` env vars.

## 11. falls back to X509_* variables for GSI — ✅ 保留

Parses `X509_CERT_DIR`, `X509_USER_CERT`, `X509_USER_KEY`, `X509_USER_PROXY` (no `XrdSecGSI*` vars). Asserts the `gsi*` fields are populated from the `X509_*` vars. Note: `gsiCrlDir` falls back to `X509_CERT_DIR` when `X509_CRL_DIR` is not set.

**Edge case:** Legacy `X509_*` env vars are supported as fallback for GSI configuration.

## 12. prefers XrdSecGSI* over X509_* — ✅ 保留

Parses both `X509_CERT_DIR: "/x509/ca"` and `XrdSecGSICADIR: "/gsi/ca"`. Asserts `gsiCaDir === "/gsi/ca"`.

**Edge case:** When both naming conventions are present, `XrdSecGSI*` takes priority.

## 13. clears GSI fields when gsi=false — ✅ 保留

Parses `XrdSecGSICADIR: "/custom/ca"` with option `gsi: false`. Asserts all five `gsi*` fields are empty strings.

**Edge case:** The `gsi: false` option clears all GSI configuration fields.

## 14. parses PWD server public key — ✅ 保留

Parses `XrdSecPWDSRVPUK: "/etc/xrootd/pwdsrvpuk"`. Asserts `pwdServerPubkey === "/etc/xrootd/pwdsrvpuk"`.

**Operation:** PWD (password) server public key path extraction.

## 15. disables PWD when pwd=false — ✅ 保留

Parses `XrdSecPWDSRVPUK: "..."` with option `pwd: false`. Asserts `pwdServerPubkey === undefined`.

**Edge case:** The `pwd: false` option clears the PWD key path.

## 16. parses XrdSecUSER and XrdSecCREDS — ✅ 保留

Parses `XrdSecUSER: "admin", XrdSecCREDS: "secret123"`. Asserts `username === "admin"` and `password === "secret123"`.

**Operation:** User credential extraction from env vars.

## 17. protocolFilter overrides env-based parsing — ✅ 保留

Parses `XrdSecPROTOCOL: "host,sss"` with option `protocolFilter: ["host"]`. Asserts `protocolFilter === ["host"]`.

**Edge case:** Explicit `protocolFilter` option takes precedence over env var parsing.

## 18. fromEnv creates instance from process.env — ✅ 保留

Calls `SecEnv.fromEnv({ XrdSecPROTOCOL: "host" })`. Asserts `protocolFilter === ["host"]`.

**Operation:** Static factory method that reads from a provided env object.

## 19. fromEnv accepts custom options — ✅ 保留

Calls `SecEnv.fromEnv({ XrdSecPROTOCOL: "host" }, { gsi: false })`. Asserts `protocolFilter === ["host"]` and `gsiCaDir === ""`.

**Operation:** `fromEnv` merges env parsing with custom options.

---

## 需要补充的测试

### SE-1. XrdSecPROTOCOL 边界情况

- 空字符串 `XrdSecPROTOCOL: ""` → `protocolFilter = []`
- 尾部逗号 `XrdSecPROTOCOL: "host,"` → `protocolFilter = ["host"]`
- 前导逗号 `XrdSecPROTOCOL: ",host"` → `protocolFilter = ["host"]`
- 单个协议 `XrdSecPROTOCOL: "gsi"` → `protocolFilter = ["gsi"]`

### SE-2. SSS 优先级：XrdSecSSSKT 优先于 XrdSecsssKT

同时设置两个环境变量，验证 `XrdSecSSSKT` 优先。

### SE-3. GSI 默认路径

不设置任何 GSI 环境变量时，验证 `gsiCaDir` 等字段使用硬编码的默认路径（如 `/etc/grid-security/certificates`）和 `homedir()` 生成的路径。

### SE-4. 所有协议同时禁用

`gsi: false, sss: false, krb5: false, pwd: false` 同时设置，验证所有相关字段被清空。

### SE-5. fromEnv 无参数调用

`SecEnv.fromEnv()` 不传参数时默认使用 `process.env`。

### SE-6. gsiCrlDir 回退路径

验证 `gsiCrlDir` 的回退路径为 `X509_CERT_DIR`（与 `gsiCaDir` 相同），这可能是复制粘贴 bug，应确认是否应为 `X509_CRL_DIR`。
