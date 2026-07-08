# url.test.ts — XRootDUrl Unit Tests

Source: `src/url/url.test.ts`

Module under test: `XRootDUrl` — XRootD URL parser that parses URLs of the form `root://[user:pass@]host[:port][/path]`.

---

## 1. parses full URL with host:port/path — ✅ 保留

Parses a fully-qualified URL `root://host.cern.ch:1095/data` and asserts that every component is extracted correctly:
- `protocol` is `"root"`
- `host` is `"host.cern.ch"`
- `port` is `1095`
- `path` is `"/data"`

**Edge case:** Ensures all URL components are parsed in isolation when every part is present.

## 2. uses default port 1094 when omitted — ✅ 保留

Parses `root://host.cern.ch/data` (no port specified) and asserts that `port` defaults to `1094`, which is the standard XRootD port.

**Edge case:** Default port fallback when the port segment is absent from the URL string.

## 3. parses roots:// secure protocol — ✅ 保留

Parses `roots://host.cern.ch/data` and asserts:
- `protocol` is `"roots"`
- `isSecure()` returns `true`

**Edge case:** Distinguishes secure (`roots://`) from non-secure (`root://`) protocol schemes.

## 4. parses user:pass@host:port/path — ✅ 保留

Parses `root://alice:secret@host.cern.ch:1095/data` and asserts:
- `user` is `"alice"`
- `password` is `"secret"`
- `host`, `port`, `path` are correct

**Edge case:** URL contains embedded credentials (username + password) which must be extracted without affecting host/port parsing.

## 5. throws on malformed URL — ✅ 保留

Asserts that constructing `new XRootDUrl("root://host:abc/port")` throws an exception, because `"abc"` is not a valid port number.

**Edge case:** Input validation — non-numeric port string triggers a parse error.

## 6. isValid() returns true for root and roots — ✅ 保留

Asserts `isValid()` returns `true` for both `root://h/p` and `roots://h/p`.

**Edge case:** Only `root` and `roots` are valid XRootD protocol schemes; any other scheme would presumably return `false`.

## 7. isSecure() returns true only for roots — ✅ 保留

Asserts:
- `root://h/p` → `isSecure()` is `false`
- `roots://h/p` → `isSecure()` is `true`

**Edge case:** Security flag is strictly tied to the `roots` protocol prefix.

## 8. getHostId() includes user:pass@host:port — ✅ 保留

Parses `root://alice:s3cr3t@host.cern.ch:1095/data` and asserts `getHostId()` returns `"alice:s3cr3t@host.cern.ch:1095"`.

**Edge case:** When credentials are present, the host identifier includes the full `user:pass@host:port` string.

## 9. getHostId() without auth — ✅ 保留

Parses `root://host.cern.ch/data` and asserts `getHostId()` returns `"host.cern.ch:1094"`.

**Edge case:** When no credentials are present, the host identifier is simply `host:port` (using the default port).

## 10. getChannelId() is host:port — ✅ 保留

Parses `root://host.cern.ch:1095/data` and asserts `getChannelId()` returns `"host.cern.ch:1095"`.

**Edge case:** `getChannelId()` always returns `host:port` regardless of credentials.

## 11. getLocation() is protocol://host:port/path — ✅ 保留

Parses `root://host.cern.ch:1095/data` and asserts `getLocation()` returns the full URL string `"root://host.cern.ch:1095/data"`.

**Edge case:** `getLocation()` reconstructs the complete URL from parsed components.

## 12. toString() round-trips — ✅ 保留

Parses `root://alice:pw@host.cern.ch:1095/data`, calls `toString()`, and asserts the output equals the original input.

**Edge case:** Serialization/deserialization round-trip preserves the full URL including credentials.

## 13. toString() omits default port — ✅ 保留

Parses `root://host.cern.ch/data` (default port 1094) and asserts `toString()` outputs `"root://host.cern.ch/data"` without `:1094`.

**Edge case:** Default port is not included in the serialized string to keep URLs clean.

## 14. static parse() creates instance — ✅ 保留

Calls `XRootDUrl.parse("root://host/path")` and asserts:
- The result is an instance of `XRootDUrl`
- `host` is `"host"`

**Edge case:** Static factory method produces a valid `XRootDUrl` object.

## 15. parses URL without path — ✅ 保留

Parses `root://host.cern.ch` (no path) and asserts `path` defaults to `"/"`.

**Edge case:** When the path segment is absent, it defaults to `"/"` rather than being `undefined` or empty.

---

## 需要补充的测试

### U-1. root:// 自动补全

`XRootDUrl.parse("host/path")` 不带 `root://` 前缀时，验证解析是否自动添加 `root://` 前缀。C++ 参考中 `XrdNetUtils::SrvName()` 对无协议字符串直接返回输入，但 TypeScript 实现可能不同。

### U-2. user@host 无密码 URL

`root://alice@host/path` 只有用户名无密码，验证 `user === "alice"` 且 `password === undefined`。

### U-3. roots:// 序列化

`roots://host/path` 的 `toString()` 输出应保留 `roots://` 前缀。

### U-4. getLocation() 与 toString() 一致性

验证两个方法在有凭证和无凭证情况下返回相同结果。

### U-5. 带特殊字符的密码

`root://user:p%40ss@host/path` 中密码包含编码的 `@` 字符，验证解码后 `password === "p@ss"`。

### U-6. 端口边界值

- 端口 0：`root://host:0/path` → 验证是否抛出或返回 port=0
- 端口 65535：最大合法端口
- 端口 65536：超出范围，验证抛出

### U-7. 空路径组件

`root://host:1095` → `path === "/"`，与 `root://host:1095/` 行为一致。

### U-8. IPv6 地址

`root://[::1]:1095/path`，验证 IPv6 地址解析是否支持。
