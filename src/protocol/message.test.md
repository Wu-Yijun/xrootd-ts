# message.test.ts — Message Builder/Parser Unit Tests

Source: `src/protocol/message.test.ts`

Module under test: XRootD protocol message builders (`build*`) and parsers (`parse*`) — functions that construct and deconstruct binary XRootD protocol messages.

---

## buildHandshakeAndProtocol

### 1. produces 44 bytes total

Asserts `buildHandshakeAndProtocol(0)` returns a 44-byte buffer (20-byte handshake + 24-byte protocol request).

**Operation:** Fixed-size message construction.

### 2. contains correct handshake constants

Asserts the ClientInitHandShake fields at specific byte offsets:
- `first (offset 0) = 0`
- `second (offset 4) = 0`
- `third (offset 8) = 0`
- `fourth (offset 12) = 4`
- `fifth (offset 16) = 2012`

**Operation:** Handshake magic values that the server expects.

### 3. contains correct protocol request fields

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

### 4. produces correct body layout

Asserts `buildLoginRequest(1, 1234, "alice", 0)` produces a 24-byte message:
- `streamId = 1`
- `requestid = 3007` (kXR_login)
- `pid = 1234`
- `username` field contains `"alice"` padded to 8 bytes
- `ability2 = 0`, `ability = 0`, `capver = 4`, `reserved = 0`
- `dlen = 0` (no CGI)

**Operation:** Validates the binary layout of the login request body.

### 5. includes CGI string as extra data when provided

Calls `buildLoginRequest(0, 100, "bob", 0, "&appname=test")`. Asserts:
- Total length = 24 + CGI byte length
- `dlen` at offset 20 equals the CGI byte length
- The extra data starting at offset 24 is the CGI string

**Edge case:** Optional CGI parameters are appended after the fixed header as extra data.

---

## buildOpenRequest

### 6. produces header + path in extra data

Calls `buildOpenRequest(5, "/data/test.txt", 0x0010)` (kXR_open_read). Asserts:
- `streamId = 5`
- `requestid = 3010` (kXR_open)
- `mode = 0`, `options = 0x0010`, `optiont = 0`
- `dlen` equals the path byte length
- The path string starts at offset 24

**Operation:** Open request includes the file path as extra data.

---

## buildReadRequest

### 7. contains fhandle + offset[8] + rlen

Calls `buildReadRequest(3, [0x01,0x02,0x03,0x04], 1024, 4096)`. Asserts:
- `streamId = 3`
- `requestid = 3013` (kXR_read)
- `fhandle` at offset 4–7 matches the input
- `offset` as 64-bit big-endian at offset 8–15: high=0, low=1024
- `rlen = 4096` at offset 16–19
- `dlen = 0`

**Operation:** Read request encodes file handle, 64-bit offset, and read length.

### 8. handles large offset

Calls `buildReadRequest(0, fhandle, 0x100000000, 100)`. Asserts the 64-bit offset is split correctly: `high = 1`, `low = 0`.

**Edge case:** Offsets exceeding 32 bits (>4GB) must be correctly encoded in the 64-bit offset field.

---

## buildWriteRequest

### 9. contains fhandle + offset[8] + data in extra

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

### 10. contains fhandle + reserved[12]

Calls `buildCloseRequest(2, [0x11,0x22,0x33,0x44])`. Asserts:
- `streamId = 2`
- `requestid = 3003` (kXR_close)
- `fhandle` at offset 4–7 matches
- `reserved` bytes at offset 8–19 are all zeros
- `dlen = 0`

**Operation:** Close request sends the file handle with zeroed reserved fields.

---

## buildStatRequest

### 11. contains path in extra data (stat by path)

Calls `buildStatRequest(4, "/myfile")`. Asserts:
- `streamId = 4`
- `requestid = 3017` (kXR_stat)
- `options = 0` at offset 4
- `dlen` equals path byte length
- Path string at offset 24

**Operation:** Stat by path includes the path as extra data.

### 12. stat by file handle has dlen=0

Calls `buildStatRequest(0, "", [0xaa,0xbb,0xcc,0xdd])`. Asserts:
- `dlen = 0` (no extra data)
- `fhandle` at offset 16–19 matches

**Edge case:** When stat is performed by file handle instead of path, `dlen` is 0 and the handle is embedded in the fixed body.

---

## parseProtocolResponse

### 13. parses pval + flags

Parses an 8-byte body with `pval=0x520, flags=0x03`. Asserts `pval`, `flags`, `seclvl=undefined`, `bifReqs=undefined`.

**Operation:** Basic protocol response parsing without optional structs.

### 14. parses secReqs binary struct (tag 'S')

Parses a body containing a `secReqs` struct (tag `0x53`): `secver=0, secopt=1, seclvl=2, secvsz=0`. Asserts `seclvl === 2` and `secopt === 1`.

**Operation:** Security requirements struct parsing with tag-based dispatch.

### 15. parses secReqs struct with secvec entries

Parses a body with `seclvl=3, secvsz=2` and two 2-byte `secvec` entries. Asserts `seclvl === 3`.

**Edge case:** The `secvec` array entries are present but not individually validated in the parsed output.

### 16. parses bifReqs binary struct (tag 'B')

Parses a body containing a `bifReqs` struct (tag `0x42`) with bifILen and bifInfo `"krb5,host"`. Asserts `bifReqs === "krb5,host"`.

**Operation:** Bif (bifurcation info) struct parsing — a string listing supported protocols.

### 17. parses both bifReqs and secReqs structs

Parses a body containing both a `bifReqs` struct and a `secReqs` struct. Asserts both `bifReqs === "host"` and `seclvl === 1` are correctly extracted.

**Edge case:** Both optional structs can appear in the same protocol response body.

---

## parseLoginResponse

### 18. parses sessid[16] without secToken

Parses a 16-byte body containing only the session ID. Asserts:
- `sessid` is `[1, 2, ..., 16]`
- `needsAuth === false`
- `secToken === undefined`

**Operation:** Login response without authentication token.

### 19. parses sessid + secToken when body > 16

Parses a 20-byte body (16-byte sessid + 4-byte secToken). Asserts:
- `needsAuth === true`
- `secToken` is `[0xaa, 0xbb, 0xcc, 0xdd]`

**Edge case:** When the body exceeds 16 bytes, the extra bytes are treated as a security token.

---

## parseSecToken

### 20. parses single protocol

Parses `"&P=host"`. Asserts `["host"]`.

**Operation:** Single protocol entry in secToken.

### 21. parses multiple protocols

Parses `"&P=host&P=sss&P=gsi"`. Asserts `["host", "sss", "gsi"]`.

**Operation:** Multiple protocol entries.

### 22. parses protocols with args (strips args)

Parses `"&P=gsi,v:42,c:ssl&P=host"`. Asserts `["gsi", "host"]` — the `,v:42,c:ssl` args are stripped.

**Edge case:** Protocol entries can have comma-separated arguments that are not included in the parsed output.

### 23. returns empty array for empty token

Parses an empty `Uint8Array`. Asserts `[]`.

**Edge case:** Empty input produces empty result.

---

## parseOpenResponse

### 24. parses fhandle[4] + cpsize[4] + cptype[4]

Parses a 12-byte body. Asserts:
- `fhandle` matches `[0xde, 0xad, 0xbe, 0xef]`
- `cpsize = 65536`
- `cptype = "zlib"`

**Operation:** Full open response with compression info.

### 25. parses minimal response with zero cpsize and empty cptype

Parses a 4-byte body (only fhandle). Asserts:
- `fhandle` matches
- `cpsize = 0`
- `cptype = ""`

**Edge case:** When the response is minimal, compression fields default to zero/empty.

---

## parseErrorResponse

### 26. parses errnum + errmsg

Parses a body with `errnum=3011` and message `"file not found"`. Asserts both fields are correctly extracted.

**Operation:** Error response parsing — 4-byte error number + null-terminated string.

---

## parseRedirectResponse

### 27. parses port + host

Parses a body with `port=1095` and host `"newhost.cern.ch"`. Asserts both fields are correctly extracted.

**Operation:** Redirect response parsing — 4-byte port + null-terminated hostname.

---

## parseWaitResponse

### 28. parses seconds + infomsg

Parses a body with `seconds=5` and message `"try again"`. Asserts both fields are correctly extracted.

**Operation:** Wait response parsing — 4-byte wait duration + null-terminated info message.
