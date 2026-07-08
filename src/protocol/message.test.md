# message.test.ts — Message Builder/Parser Unit Tests

Source: `src/protocol/message.test.ts`

Module under test: XRootD protocol message builders (`build*`) and parsers (`parse*`) — functions that construct and deconstruct binary XRootD protocol messages.

---

## buildHandshakeAndProtocol

### 1. produces 44 bytes total — ✅ 保留

Asserts `buildHandshakeAndProtocol(0)` returns a 44-byte buffer (20-byte handshake + 24-byte protocol request).

**Operation:** Fixed-size message construction.

### 2. contains correct handshake constants — ✅ 保留

Asserts the ClientInitHandShake fields at specific byte offsets:
- `first (offset 0) = 0`
- `second (offset 4) = 0`
- `third (offset 8) = 0`
- `fourth (offset 12) = 4`
- `fifth (offset 16) = 2012`

**Operation:** Handshake magic values that the server expects.

### 3. contains correct protocol request fields — ✅ 保留

Calls `buildHandshakeAndProtocol(0, 0x09, 0x01)` with custom flags and expect values. Asserts:
- `streamId (offset 20) = 0`
- `requestid (offset 22) = 3006` (kXR_protocol)
- `clientpv (offset 24) = 0x520`
- `flags (offset 28) = 0x09`
- `expect (offset 29) = 0x01`
- `reserved (offset 30–39)` are all zeros
- `dlen (offset 40) = 0`

**Operation:** Validates the full binary layout of the protocol request portion.

---

## buildLoginRequest

### 4. produces correct body layout — ✅ 保留

Asserts `buildLoginRequest(1, 1234, "alice", 0)` produces a 24-byte message:
- `streamId = 1`
- `requestid = 3007` (kXR_login)
- `pid = 1234`
- `username` field contains `"alice"` padded to 8 bytes
- `ability2 = 0`, `ability = 0`, `capver = 4`, `reserved = 0`
- `dlen = 0` (no CGI)

**Operation:** Validates the binary layout of the login request body.

### 5. includes CGI string as extra data when provided — ✅ 保留

Calls `buildLoginRequest(0, 100, "bob", 0, "&appname=test")`. Asserts:
- Total length = 24 + CGI byte length
- `dlen` at offset 20 equals the CGI byte length
- The extra data starting at offset 24 is the CGI string

**Edge case:** Optional CGI parameters are appended after the fixed header as extra data.

---

## buildOpenRequest

### 6. produces header + path in extra data — ✅ 保留

Calls `buildOpenRequest(5, "/data/test.txt", 0x0010)` (kXR_open_read). Asserts:
- `streamId = 5`
- `requestid = 3010` (kXR_open)
- `mode = 0`, `options = 0x0010`, `optiont = 0`
- `dlen` equals the path byte length
- The path string starts at offset 24

**Operation:** Open request includes the file path as extra data.

---

## buildReadRequest

### 7. contains fhandle + offset[8] + rlen — ✅ 保留

Calls `buildReadRequest(3, [0x01,0x02,0x03,0x04], 1024, 4096)`. Asserts:
- `streamId = 3`
- `requestid = 3013` (kXR_read)
- `fhandle` at offset 4–7 matches the input
- `offset` as 64-bit big-endian at offset 8–15: high=0, low=1024
- `rlen = 4096` at offset 16–19
- `dlen = 0`

**Operation:** Read request encodes file handle, 64-bit offset, and read length.

### 8. handles large offset — ✅ 保留

Calls `buildReadRequest(0, fhandle, 0x100000000, 100)`. Asserts the 64-bit offset is split correctly: `high = 1`, `low = 0`.

**Edge case:** Offsets exceeding 32 bits (>4GB) must be correctly encoded in the 64-bit offset field.

---

## buildWriteRequest

### 9. contains fhandle + offset[8] + data in extra — ✅ 保留

Calls `buildWriteRequest(7, [0xaa,0xbb,0xcc,0xdd], 2048, [1,2,3,4,5])`. Asserts:
- `streamId = 7`
- `requestid = 3019` (kXR_write)
- `fhandle` at offset 4–7 matches
- `offset` as 64-bit BE at offset 8–15: high=0, low=2048
- `pathid = 0` at offset 16
- `dlen = 5` at offset 20–23
- Data bytes `[1,2,3,4,5]` at offset 24–28

**Operation:** Write request encodes file handle, offset, and data payload as extra data.

---

## buildCloseRequest

### 10. contains fhandle + reserved[12] — ✅ 保留

Calls `buildCloseRequest(2, [0x11,0x22,0x33,0x44])`. Asserts:
- `streamId = 2`
- `requestid = 3003` (kXR_close)
- `fhandle` at offset 4–7 matches
- `reserved` bytes at offset 8–19 are all zeros
- `dlen = 0`

**Operation:** Close request sends the file handle with zeroed reserved fields.

---

## buildStatRequest

### 11. contains path in extra data (stat by path) — ✅ 保留

Calls `buildStatRequest(4, "/myfile")`. Asserts:
- `streamId = 4`
- `requestid = 3017` (kXR_stat)
- `options = 0` at offset 4
- `dlen` equals path byte length
- Path string at offset 24

**Operation:** Stat by path includes the path as extra data.

### 12. stat by file handle has dlen=0 — ✅ 保留

Calls `buildStatRequest(0, "", [0xaa,0xbb,0xcc,0xdd])`. Asserts:
- `dlen = 0` (no extra data)
- `fhandle` at offset 16–19 matches

**Edge case:** When stat is performed by file handle instead of path, `dlen` is 0 and the handle is embedded in the fixed body.

---

## parseProtocolResponse

### 13. parses pval + flags — ✅ 保留

Parses an 8-byte body with `pval=0x520, flags=0x03`. Asserts `pval`, `flags`, `seclvl=undefined`, `bifReqs=undefined`.

**Operation:** Basic protocol response parsing without optional structs.

### 14. parses secReqs binary struct (tag 'S') — ✅ 保留

Parses a body containing a `secReqs` struct (tag `0x53`): `secver=0, secopt=1, seclvl=2, secvsz=0`. Asserts `seclvl === 2` and `secopt === 1`.

**Operation:** Security requirements struct parsing with tag-based dispatch.

### 15. parses secReqs struct with secvec entries — ✅ 保留

Parses a body with `seclvl=3, secvsz=2` and two 2-byte `secvec` entries. Asserts `seclvl === 3`.

**Edge case:** The `secvec` array entries are present but not individually validated in the parsed output.

### 16. parses bifReqs binary struct (tag 'B') — ✅ 保留

Parses a body containing a `bifReqs` struct (tag `0x42`) with bifILen and bifInfo `"krb5,host"`. Asserts `bifReqs === "krb5,host"`.

**Operation:** Bif (bifurcation info) struct parsing — a string listing supported protocols.

### 17. parses both bifReqs and secReqs structs — ✅ 保留

Parses a body containing both a `bifReqs` struct and a `secReqs` struct. Asserts both `bifReqs === "host"` and `seclvl === 1` are correctly extracted.

**Edge case:** Both optional structs can appear in the same protocol response body.

---

## parseLoginResponse

### 18. parses sessid[16] without secToken — ✅ 保留

Parses a 16-byte body containing only the session ID. Asserts:
- `sessid` is `[1, 2, ..., 16]`
- `needsAuth === false`
- `secToken === undefined`

**Operation:** Login response without authentication token.

### 19. parses sessid + secToken when body > 16 — ✅ 保留

Parses a 20-byte body (16-byte sessid + 4-byte secToken). Asserts:
- `needsAuth === true`
- `secToken` is `[0xaa, 0xbb, 0xcc, 0xdd]`

**Edge case:** When the body exceeds 16 bytes, the extra bytes are treated as a security token.

---

## parseSecToken

### 20. parses single protocol — ✅ 保留

Parses `"&P=host"`. Asserts `["host"]`.

**Operation:** Single protocol entry in secToken.

### 21. parses multiple protocols — ✅ 保留

Parses `"&P=host&P=sss&P=gsi"`. Asserts `["host", "sss", "gsi"]`.

**Operation:** Multiple protocol entries.

### 22. parses protocols with args (strips args) — ✅ 保留

Parses `"&P=gsi,v:42,c:ssl&P=host"`. Asserts `["gsi", "host"]` — the `,v:42,c:ssl` args are stripped.

**Edge case:** Protocol entries can have comma-separated arguments that are not included in the parsed output.

### 23. returns empty array for empty token — ✅ 保留

Parses an empty `Uint8Array`. Asserts `[]`.

**Edge case:** Empty input produces empty result.

---

## parseOpenResponse

### 24. parses fhandle[4] + cpsize[4] + cptype[4] — ✅ 保留

Parses a 12-byte body. Asserts:
- `fhandle` matches `[0xde, 0xad, 0xbe, 0xef]`
- `cpsize = 65536`
- `cptype = "zlib"`

**Operation:** Full open response with compression info.

### 25. parses minimal response with zero cpsize and empty cptype — ✅ 保留

Parses a 4-byte body (only fhandle). Asserts:
- `fhandle` matches
- `cpsize = 0`
- `cptype = ""`

**Edge case:** When the response is minimal, compression fields default to zero/empty.

---

## parseErrorResponse

### 26. parses errnum + errmsg — ✅ 保留

Parses a body with `errnum=3011` and message `"file not found"`. Asserts both fields are correctly extracted.

**Operation:** Error response parsing — 4-byte error number + null-terminated string.

---

## parseRedirectResponse

### 27. parses port + host — ✅ 保留

Parses a body with `port=1095` and host `"newhost.cern.ch"`. Asserts both fields are correctly extracted.

**Operation:** Redirect response parsing — 4-byte port + null-terminated hostname.

---

## parseWaitResponse

### 28. parses seconds + infomsg — ✅ 保留

Parses a body with `seconds=5` and message `"try again"`. Asserts both fields are correctly extracted.

**Operation:** Wait response parsing — 4-byte wait duration + null-terminated info message.

---

## 需要补充的测试

### Builder 缺失（9 个 builder 完全未测试）

以下 builder 函数在 C++ 源码（`XProtocol.hh`）中有对应的请求结构定义，但当前测试文件未导入也未测试：

#### M-1. buildSyncRequest — 🔴 需要添加

验证 `buildSyncRequest(streamId, fhandle)` 生成的 24 字节消息：
- `requestid = 3016`（kXR_sync）
- `fhandle` 位于 offset 4–7
- `reserved[12]` 位于 offset 8–19 全为零
- `dlen = 0`

对应 C++ 结构：`ClientSyncRequest` — fhandle[4] + reserved[12]。

#### M-2. buildTruncateRequest — 🔴 需要添加

验证 `buildTruncateRequest(streamId, fhandle, size)` 生成的 32 字节消息：
- `requestid = 3028`（kXR_truncate）
- `fhandle` 位于 offset 4–7
- `dlen = 8`（额外数据为 8 字节 size）
- 额外数据中 `size` 作为 64 位大端整数编码（与 buildReadRequest 的 offset 编码方式一致）
- 测试大文件 size > 4GB 的情况

对应 C++ 结构：`ClientTruncateRequest` — fhandle[4] + reserved[12]，extra: size[8]。

#### M-3. buildDirlistRequest — 🔴 需要添加

验证 `buildDirlistRequest(streamId, path, options)` 生成的消息：
- `requestid = 3004`（kXR_dirlist）
- `reserved[15]` 位于 offset 4–18 全为零
- `options` 位于 offset 19（单字节）
- `dlen` 等于 path 字节长度
- path 位于 offset 24

默认 `options = 0`；传入 `DirlistOptions.Dstat (2)` 时 offset 19 应为 2。

对应 C++ 结构：`ClientDirlistRequest` — reserved[15] + options[1]。

#### M-4. buildMkdirRequest — 🔴 需要添加

验证 `buildMkdirRequest(streamId, path, mode)` 生成的消息：
- `requestid = 3008`（kXR_mkdir）
- `mode` 位于 offset 17–18（uint16 BE，默认 `DEFAULT_DIR_MODE`）
- `dlen` 等于 path 字节长度
- path 位于 offset 24

对应 C++ 结构：`ClientMkdirRequest` — reserved[14] + mode[2]。

#### M-5. buildRmdirRequest — 🔴 需要添加

验证 `buildRmdirRequest(streamId, path)` 生成的消息：
- `requestid = 3015`（kXR_rmdir）
- `reserved[16]` 位于 offset 4–19 全为零
- `dlen` 等于 path 字节长度

对应 C++ 结构：`ClientRmdirRequest` — reserved[16]。

#### M-6. buildRmRequest — 🔴 需要添加

验证 `buildRmRequest(streamId, path)` 生成的消息：
- `requestid = 3014`（kXR_rm）
- `reserved[16]` 位于 offset 4–19 全为零
- `dlen` 等于 path 字节长度

对应 C++ 结构：`ClientRmRequest` — reserved[16]。

#### M-7. buildMvRequest — 🔴 需要添加

验证 `buildMvRequest(streamId, source, target)` 生成的消息：
- `requestid = 3009`（kXR_mv）
- `arg1len` 位于 offset 18–19（uint16 BE），值为 source 字节长度
- `dlen = srcLen + 1 + tgtLen`（source + 空格分隔符 + target）
- 额外数据格式：`source + " " + target`（0x20 空格分隔）

对应 C++ 结构：`ClientMvRequest` — reserved[14] + arg1len[2]。C++ 服务端 `do_Mv()` 使用 `arg1len` 来分割 source 和 target。

#### M-8. buildAuthRequest — 🔴 需要添加

验证 `buildAuthRequest(streamId, credType, credData)` 生成的消息：
- `requestid = 3000`（kXR_auth）
- `reserved[12]` 位于 offset 4–15 全为零
- `credType` 位于 offset 16–19（int32 BE，对应 `CRED_TYPE` 常量）
- `dlen` 等于 credData 长度
- credData 位于 offset 24

对应 C++ 结构：`ClientAuthRequest` — reserved[12] + credtype[4]。

#### M-9. buildEndsessRequest — 🔴 需要添加

验证 `buildEndsessRequest(streamId, sessid)` 生成的 24 字节消息：
- `requestid = 3023`（kXR_endsess）
- `sessid` 位于 offset 4–19（16 字节）
- `dlen = 0`

对应 C++ 结构：`ClientEndsessRequest` — sessid[16]。

### Parser 缺失（2 个 parser 完全未测试）

#### M-10. parseSpnPrefix — 🔴 需要添加

验证 `parseSpnPrefix(token, protocol)` 从 secToken 中提取 Kerberos SPN 前缀：
- 输入 `"&P=krb5,host/eos07.ihep.ac.cn@IHEPKRB5&P=unix"` + `protocol="krb5"` → 返回 `"host"`
- 输入 `"&P=krb5,xrootd/eos01.ihep.ac.cn@IHEPKRB5&P=unix"` + `protocol="krb5"` → 返回 `"xrootd"`
- 输入 `"&P=host&P=sss"` + `protocol="krb5"` → 返回 `undefined`（无 krb5 条目）
- 输入 `"&P=krb5,noslash&P=host"` + `protocol="krb5"` → 返回 `undefined`（无斜杠）

对应 C++ 源码中 `XrdSecKrb5` 的 SPN 解析逻辑。SPN 格式为 `<prefix>/<realm>`，取斜杠前部分。

#### M-11. parseDirlistResponse — 🔴 需要添加

验证 `parseDirlistResponse(body)` 解析两种 dirlist 格式（参考 C++ `XrdXrootdXeq.cc:do_Dirlist()` 和 `do_DirStat()`）：

**名称格式（默认）：**
- 输入 `"file1\nfile2\nfile3\0"` → 3 个条目，name 分别为 `"file1"`, `"file2"`, `"file3"`
- 输入 `"single\0"` → 1 个条目
- 空 body → 0 个条目

**dstat 格式（带 `kXR_dstat` 标志）：**
- 前缀为 `".\n0 0 0 0\n"`（lead-in dot entry，C++ 中 `do_DirStat` 写入的 marker）
- 条目成对出现：`name\n<statinfo>`
- statinfo 格式：`"<devid> <size> <flags> <mtime> [<ctime> <atime> <mode> <owner> <group>]"`
- 解析 4 字段格式：`"12345 1024 0 1700000000"` → `{name, size:1024, flags:0, mtime:1700000000}`
- 解析 9 字段扩展格式：`"12345 1024 2 1700000000 1700000100 1700000200 040755 root root"` → 包含 `ctime`, `atime`, `mode`（八进制解析）, `owner`, `group`

### 现有测试补充

#### M-12. parseProtocolResponse — 未知 tag 字节

当 body 中包含未知 tag（非 `'B'` 非 `'S'`）时，解析循环应立即终止，已解析的字段保留。

#### M-13. parseErrorResponse — 空消息

解析 `errnum=3000` + 仅 NUL 终止符（无实际消息文本）的 body，验证 `errmsg` 为空字符串。

#### M-14. parseOpenResponse — 中间长度 body

解析 8 字节 body（有 fhandle + cpsize 但无 cptype），验证 `cpsize` 正确解析且 `cptype = ""`。
