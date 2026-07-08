# codec.test.ts — Codec Unit Tests

Source: `src/protocol/codec.ts`

Module under test: Binary codec utilities (`put16/get16`, `put32/get32`, `putString/getString`, `putBytes/getBytes`) for reading and writing XRootD protocol fields to/from buffers in big-endian byte order.

---

## put16 / get16

### 1. round-trips uint16 values — ✅ 保留

Writes `0x1234` at offset 0 and `0x0000` at offset 2 using `put16`, then reads them back with `get16`. Asserts values and offsets are correct (`off1=2, off2=4`).

**Operation:** Basic 16-bit write/read round-trip.

### 2. writes big-endian byte order — ✅ 保留

Writes `0x0102` to a buffer and asserts `buf[0] === 0x01, buf[1] === 0x02`.

**Operation:** Byte order verification — XRootD uses network byte order (big-endian).

### 3. returns new offset — ✅ 保留

Asserts `put16(buf, 0, 0xabcd)` returns offset `2`.

**Operation:** The write function returns the next available offset for chaining.

---

## put32 / get32

### 4. round-trips uint32 values — ✅ 保留

Writes `0xdeadbeef` at offset 0 and `0` at offset 4 using `put32`, then reads them back. Asserts values and offsets are correct (`off1=4, off2=8`).

**Operation:** Basic 32-bit write/read round-trip.

### 5. writes big-endian byte order — ✅ 保留

Writes `0x01020304` and asserts `buf[0..3]` are `[0x01, 0x02, 0x03, 0x04]`.

**Operation:** Byte order verification for 32-bit values.

### 6. returns new offset — ✅ 保留

Asserts `put32(buf, 0, 12345)` returns offset `4`.

**Operation:** Offset chaining for 32-bit writes.

---

## putString / getString

### 7. round-trips a string with null padding — ✅ 保留

Writes `"hello"` to a 16-byte buffer with field width 8 using `putString`, then reads it back with `getString`. Asserts:
- Write returns offset `8`
- Read returns `"hello"` and offset `8`

**Operation:** Strings are null-padded to the specified field width.

### 8. truncates strings longer than maxLen — ✅ 保留

Writes `"hello world"` (11 chars) to an 8-byte field using `putString`, then reads with `getString`. Asserts the result is `"hello wo"` (truncated to 8 bytes).

**Edge case:** Strings exceeding the field width are silently truncated.

### 9. pads short strings with zeros — ✅ 保留

Writes `"hi"` (2 chars) to an 8-byte field using `putString`. Asserts bytes at indices 2–7 are all zero.

**Edge case:** Short strings are padded with null bytes to fill the field.

### 10. round-trips empty string — ✅ 保留

Writes `""` to a 4-byte field using `putString`, then reads with `getString`. Asserts the result is `""`.

**Edge case:** Empty string is valid and round-trips correctly.

### 11. getString trims trailing null bytes — ✅ 保留

Manually writes `"abc"` followed by zero padding to an 8-byte buffer. Reads with `getString` and asserts the result is `"abc"`.

**Edge case:** `getString` removes trailing null bytes from the decoded string.

---

## putBytes / getBytes

### 12. round-trips raw bytes — ✅ 保留

Writes `[0xde, 0xad, 0xbe, 0xef]` using `putBytes`, then reads back with `getBytes`. Asserts values and offset match.

**Operation:** Raw byte array write/read round-trip.

### 13. copies into correct offset — ✅ 保留

Writes `[0xaa, 0xbb]` at offset 4 using `putBytes`, then reads from offset 4. Asserts the bytes match.

**Operation:** Offset targeting — bytes are placed at the specified position.

### 14. returns new offset after putBytes — ✅ 保留

Asserts `putBytes(buf, 3, [1, 2, 3])` returns offset `6`.

**Operation:** Offset chaining for byte array writes.

---

## 需要补充的测试

以下测试用例当前未覆盖，建议添加：

### C-1. put16/get16 边界值

- 写入/读取 `0xFFFF`（uint16 最大值），验证值和偏移正确。
- 从非零偏移（如 offset=4）读取 `get16`，验证偏移从指定位置开始。

### C-2. put32/get32 边界值

- 写入/读取 `0xFFFFFFFF`（uint32 最大值），验证值和偏移正确。
- 从非零偏移（如 offset=6）读取 `get32`。

### C-3. putString/getString 字符串边界

- `putString` 精确匹配 `maxLen` 长度的字符串（如 `"hello"` 写入 5 字节字段），验证不截断、不填充。
- `getString` 中间包含 NUL 字节的字符串（如 `"ab\0cd"`），验证 NUL 被保留而非被 trim（当前实现仅 trim 尾部 NUL）。
- 多字节 UTF-8 字符（如中文 `"你好"`）写入 `putString`，验证截断行为（按字节截断可能产生不完整字符）。

### C-4. getBytes 边界

- `getBytes(buf, offset, 0)` — 长度为 0 时返回空 `Uint8Array`。
- `putBytes` 写入空 `Uint8Array`，验证偏移不变。

### C-5. Buffer 越界

- `get16`/`get32` 在 buffer 末尾不足字节时的行为（应抛出 `RangeError`）。
- `put16`/`put32` 在 buffer 末尾空间不足时的行为。
