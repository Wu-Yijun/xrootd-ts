# Fix Plan: Phase 2 Interface & Protocol Gaps

This document identifies all bugs, missing fields, and incomplete implementations
in the current codebase, organized by priority. Each item includes the root cause,
the affected files, and the C++ reference for verification.

---

## Table of Contents

- [P0 — Critical Bugs](#p0--critical-bugs)
  - [1. StatInfo: XRootD flags 字段从未解析](#1-statinfo-xrootd-flags-字段从未解析)
  - [2. StatInfo: id/size 精度丢失](#2-statinfo-idsize-精度丢失)
  - [3. Dirlist: 普通格式解析使用错误分隔符](#3-dirlist-普通格式解析使用错误分隔符)
  - [4. Dirlist: dstat 格式检测与解析逻辑完全错误](#4-dirlist-dstat-格式检测与解析逻辑完全错误)
- [P1 — Missing Data Fields](#p1--missing-data-fields)
  - [5. StatInfo: 缺失 ctime/atime/owner/group 字段](#5-statinfo-缺失-ctimeatimeownergroup-字段)
  - [6. StatInfo: isOffline/isCached 始终返回 false](#6-statinfo-isofflineiscached-始终返回-false)
  - [7. OpenResponse: 缺失 cpsize/cptype 字段](#7-openresponse-缺失-cpsizecptype-字段)
  - [8. DirectoryEntry: 结构与 C++ binding 不一致](#8-directoryentry-结构与-c-binding-不一致)
- [P2 — Missing Constants](#p2--missing-constants)
  - [9. 缺少 StatFlags 常量](#9-缺少-statflags-常量)
  - [10. 缺少 DirlistOptions 常量](#10-缺少-dirlistoptions-常量)
- [P3 — Handshake Auth Integration](#p3--handshake-auth-integration)
  - [11. doAuthentication 未接入 connect 流程](#11-doauthentication-未接入-connect-流程)
- [P4 — Missing Request Builders](#p4--missing-request-builders)
  - [12. 缺少 Ping/Chmod/Query/Locate 构建器](#12-缺少-pingchmodquerylocate-构建器)

---

## P0 — Critical Bugs

### 1. StatInfo: XRootD flags 字段从未解析

**严重性**: Critical — `isOffline`、`isCached` 等属性无法工作，`flags` 属性语义错误

**当前代码** (`src/api/types.ts:21-46`):

```typescript
export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/);
  const id = parseInt(parts[0] ?? "0", 10) || 0;
  const size = parseInt(parts[1] ?? "0", 10) || 0;
  const mtime = parseInt(parts[3] ?? "0", 10) || 0;
  const modeStr = parts[6] ?? "0";
  const mode = parseInt(modeStr, 8) || 0;
  // ...
  return { id, size, mtime, mode, /* ... */ };
}
```

**问题**:
- `parts[2]` 是 XRootD 服务器返回的 flags 位掩码 (kXR_readable=16, kXR_writable=32,
  kXR_offline=8, kXR_isDir=2 等)，**从未被读取**
- 接口的 `flags` 属性存储的是 `parts[6]` 的 POSIX mode (如 `0o100644`)，与 XRootD flags
  是完全不同的两个概念
- 注释声称格式为 `"id size ctime mtime atime crtime mode owner group"` 但实际格式为
  `"id size flags mtime ctime atime mode owner group"`

**C++ 服务器格式** (`xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:807-819`):

```cpp
// 格式: <devid> <size> <flags> <mtime> <ctime> <atime> <mode> <owner> <group>
m = snprintf(xxBuff, xxLen, "%lld %lld %d %lld",
             Dev.uuid, fsz, flags, (long long) buf.st_mtime);
// extended fields (always appended — the xtnd guard is commented out):
n = snprintf(xxBuff, xxLen, "%lld %lld %04o ",
             (long long) buf.st_ctime, (long long) buf.st_atime,
             buf.st_mode & 07777);
// then owner + group
```

**C++ 客户端解析** (`xrootd/src/XrdCl/XrdClXRootDResponses.cc:134-206`):

```cpp
pId    = chunks[0];       // string
pSize  = strtoll(chunks[1]); // uint64
pFlags = strtol(chunks[2]);  // XRootD flags bitmask
pModifyTime = strtoll(chunks[3]); // mtime
// if >= 9 chunks:
pChangeTime = strtoll(chunks[4]); // ctime
pAccessTime = strtoll(chunks[5]); // atime
pMode  = chunks[6];       // octal mode string "0755"
pOwner = chunks[7];
pGroup = chunks[8];
```

**修改方案**:

在 `createStatInfo` 中提取 `parts[2]` 作为 XRootD flags：

```typescript
export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/);
  const id = parts[0] ?? "0";
  const size = BigInt(parts[1] ?? "0");
  const serverFlags = parseInt(parts[2] ?? "0", 10) || 0;  // XRootD flags
  const mtime = parseInt(parts[3] ?? "0", 10) || 0;
  const ctime = parseInt(parts[4] ?? "0", 10) || 0;
  const atime = parseInt(parts[5] ?? "0", 10) || 0;
  const modeStr = parts[6] ?? "0";
  const mode = parseInt(modeStr, 8) || 0;
  const owner = parts[7] ?? "";
  const group = parts[8] ?? "";
  // ...
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/api/types.ts` | 重写 `createStatInfo`，更新 `StatInfo` 接口 |
| `src/api/file.ts:185-187` | `parseStatInfo` 调用链无需改动 (已委托给 `createStatInfo`) |
| `src/api/filesystem.ts:34` | 同上 |
| `src/api/filesystem.test.ts` | 更新测试断言 |
| `tests/integration/filesystem.integration.test.ts` | 更新类型检查 |
| `tests/integration/file-read.integration.test.ts` | 更新 size 断言 |

**C++ 参考**:
- `xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:747-851` — StatGen 生成格式
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:134-206` — StatInfoImpl::ParseServerResponse
- `xrootd/src/XrdCl/XrdClXRootDResponses.hh:409-440` — StatInfoImpl 字段定义

---

### 2. StatInfo: id/size 精度丢失

**严重性**: Critical — 64 位打包值超出 JS number 安全范围

**当前代码** (`src/api/types.ts:23-24`):

```typescript
const id = parseInt(parts[0] ?? "0", 10) || 0;   // number
const size = parseInt(parts[1] ?? "0", 10) || 0;  // number
```

**问题**:
- `id` 是 `(st_dev << 32) | st_ino` 打包的 64 位值。在现代 Linux 上 st_dev 和 st_ino
  均为 64 位，打包值轻易超过 `Number.MAX_SAFE_INTEGER` (2^53-1 ≈ 9×10^15)
- `size` 是 `uint64_t`，虽然实际文件超过 8 PB 的情况罕见，但协议层面是 64 位
- C++ 参考实现将 `id` 存为 `std::string` (从未解析为数值)，`size` 存为 `uint64_t`

**修改方案**:

`id` 改为 `string`，`size` 改为 `bigint`：

```typescript
export interface StatInfo {
  id: string;      // was: number — opaque 64-bit devid, cannot safely parse as number
  size: bigint;    // was: number — uint64 file size
  mtime: number;
  // ...
}

export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/);
  const id = parts[0] ?? "0";
  const size = BigInt(parts[1] ?? "0");
  // ...
}
```

**影响范围**:

| 文件 | 影响 |
|------|------|
| `src/api/types.ts` | 接口 + 工厂函数 |
| `src/api/filesystem.test.ts:90-91` | `assert.equal(info.id, 12345)` → `assert.equal(info.id, "12345")` |
| `tests/integration/filesystem.integration.test.ts:77` | `typeof info.id === "number"` → `typeof info.id === "string"` |
| `tests/integration/file-read.integration.test.ts:138-140` | `assert.equal(info.size, Buffer.byteLength(...))` 需转为 BigInt 比较 |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClXRootDResponses.hh:425-426` — `std::string pId; uint64_t pSize;`
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:145,148` — `pId = chunks[0]; pSize = strtoll(...)`

---

### 3. Dirlist: 普通格式解析使用错误分隔符

**严重性**: Critical — 普通 dirlist 返回的所有条目被合并成单个条目

**当前代码** (`src/protocol/parsers.ts:187-201`):

```typescript
// Normal case (no metadata):
const text = body.toString("utf8");
const parts = text.split("\0");  // ← 按 null 字节分割
for (const part of parts) {
  const name = part.trim();
  if (name.length > 0) {
    entries.push({ name, size: 0, flags: 0, mtime: 0 });
  }
}
```

**C++ 服务器实际格式** (`xrootd/src/XrdXrootd/XrdXrootdXeq.cc:780-796`):

```cpp
// 普通 dirlist: 按 \n 分隔，最后一个条目以 \0 结尾
strcpy(buff, dname); buff += dlen; *buff = '\n'; buff++;
// ...
*(buff-1) = '\0';  // 只有最后一个字节是 null
```

**实际字节**: `name1\nname2\nname3\0`

**问题**: 按 `\0` 分割得到 `["name1\nname2\nname3", ""]`，第一个元素 trim 后为
`"name1\nname2\nname3"` — 所有名字合并成一个条目。

**修改方案**:

```typescript
// Normal case: newline-separated, last entry null-terminated
const text = body.toString("utf8").replace(/\0$/, ""); // strip trailing null
const names = text.split("\n");
for (const name of names) {
  const trimmed = name.trim();
  if (trimmed.length > 0) {
    entries.push({ name: trimmed, size: 0, flags: 0, mtime: 0 });
  }
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/parsers.ts:187-201` | 重写普通 dirlist 解析逻辑 |

**C++ 参考**:
- `xrootd/src/XrdXrootd/XrdXrootdXeq.cc:778-796` — do_Dirlist 发送格式
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:563-567` — C++ 客户端按 `\n` 分割

---

### 4. Dirlist: dstat 格式检测与解析逻辑完全错误

**严重性**: Critical — dstat 响应无法正确解析

**当前代码** (`src/protocol/parsers.ts:163-186`):

```typescript
// Detection:
const hasMetadata = body.toString("utf8").includes("\0") &&
    body.toString("utf8").includes(":");  // ← 检查 ":" 但实际用空格

// Parsing:
const fields = rest.split(":");  // ← 按 ":" 分割但实际是空格分隔
```

**C++ 服务器 dstat 格式** (`xrootd/src/XrdXrootd/XrdXrootdXeq.cc:856,880-893`):

```
.\n0 0 0 0\nname1\n<statinfo1>\nname2\n<statinfo2>\n...\0
```

- 前缀 `".\n0 0 0 0"` 表示支持 dstat (C++ 用 `dStatPrefix = ".\n0 0 0 0"`)
- 每个条目为两行: `name\nstatinfo\n`
- statinfo 格式与 stat 响应相同: `devid size flags mtime ctime atime mode owner group`
- 条目间**没有** null 字节分隔 (仅末尾有 `\0`)

**C++ 客户端检测** (`xrootd/src/XrdCl/XrdClXRootDResponses.cc:509,594-597`):

```cpp
const std::string DirectoryList::dStatPrefix = ".\n0 0 0 0";

bool DirectoryList::HasStatInfo(const char *data) {
    std::string dat = data;
    return !dat.compare(0, dStatPrefix.size(), dStatPrefix);
}
```

**修改方案**:

```typescript
const DSTAT_PREFIX = ".\n0 0 0 0";

export function parseDirlistResponse(body: Buffer): DirlistResponse {
  const entries: DirectoryEntry[] = [];
  if (body.length === 0) return { entries };

  const text = body.toString("utf8").replace(/\0$/, "");

  // Detect dstat format by prefix
  if (text.startsWith(DSTAT_PREFIX)) {
    // dstat format: ".\n0 0 0 0\nname1\nstatinfo1\nname2\nstatinfo2\n..."
    const content = text.slice(DSTAT_PREFIX.length + 1); // skip prefix + \n
    const lines = content.split("\n").filter(l => l.length > 0);

    // Lines come in pairs: name, statinfo
    for (let i = 0; i < lines.length - 1; i += 2) {
      const name = lines[i];
      const statFields = lines[i + 1]?.split(/\s+/);
      if (statFields && statFields.length >= 4) {
        entries.push({
          name,
          size: parseInt(statFields[1], 10) || 0,
          flags: parseInt(statFields[2], 10) || 0,
          mtime: parseInt(statFields[3], 10) || 0,
        });
      }
    }
  } else {
    // Normal format: "name1\nname2\nname3"
    const names = text.split("\n");
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        entries.push({ name: trimmed, size: 0, flags: 0, mtime: 0 });
      }
    }
  }

  return { entries };
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/parsers.ts:152-205` | 重写 `parseDirlistResponse` |

**C++ 参考**:
- `xrootd/src/XrdXrootd/XrdXrootdXeq.cc:812-911` — do_DirStat 完整实现
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:509,530-598` — C++ 客户端解析

---

## P1 — Missing Data Fields

### 5. StatInfo: 缺失 ctime/atime/owner/group 字段

**严重性**: High — 重要元数据丢失

**当前接口** (`src/api/types.ts:10-19`):

```typescript
export interface StatInfo {
  id: number;
  size: number;
  mtime: number;
  mode: number;
  // 缺失: ctime, atime, owner, group
}
```

**C++ binding 暴露的完整字段** (`xrootd-binding/src/handlers/AsyncStatHandler.hpp`):

| 字段 | C++ Getter | TS 状态 |
|------|-----------|---------|
| `id` | `GetId()` | ✓ (类型需改) |
| `size` | `GetSize()` | ✓ (类型需改) |
| `flags` | `GetFlags()` | ✗ (语义错误，见 #1) |
| `modTime` | `GetModTime()` | ✓ (命名不一致) |
| `accessTime` | `GetAccessTime()` | **缺失** |
| `changeTime` | `GetChangeTime()` | **缺失** |
| `owner` | `GetOwner()` | **缺失** |
| `group` | `GetGroup()` | **缺失** |
| `checksum` | `GetChecksum()` | **缺失** (可选) |
| `modeAsOctString` | `GetModeAsOctString()` | **缺失** |

**修改方案**:

```typescript
export interface StatInfo {
  id: string;
  size: bigint;
  flags: number;      // XRootD flags bitmask (kXR_readable etc.)
  mtime: number;
  ctime: number;      // change time
  atime: number;      // access time
  mode: number;       // POSIX mode (from parts[6])
  owner: string;
  group: string;
  get isDirectory(): boolean;
  get isLink(): boolean;
  get isOffline(): boolean;
  get isCached(): boolean;
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/api/types.ts` | 扩展 `StatInfo` 接口和 `createStatInfo` |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:169-192` — 扩展字段解析
- `xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:812-851` — 服务器生成格式

---

### 6. StatInfo: isOffline/isCached 始终返回 false

**严重性**: Medium — stub 实现，依赖 #1 修复后才能正确工作

**当前代码** (`src/api/types.ts:40-45`):

```typescript
get isOffline() {
  return false;  // ← stub
},
get isCached() {
  return false;  // ← stub
},
```

**C++ 服务器 flags** (`xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:792,801-802`):

```cpp
if (!Dev.uuid)                    flags |= kXR_offline;     // bit 8
if ((fsFeatures & XrdSfs::hasCACH) != 0 && buf.st_atime != 0)
                                  flags |= kXR_cachersp;    // bit 512
```

**修改方案** (依赖 #1 修复):

```typescript
get isOffline() {
  return (serverFlags & StatFlags.Offline) !== 0;
},
get isCached() {
  return (serverFlags & StatFlags.CacheResp) !== 0;
},
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/api/types.ts` | 修复 getter 实现 |

**C++ 参考**:
- `xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:792,801-802` — flags 计算逻辑

---

### 7. OpenResponse: 缺失 cpsize/cptype 字段

**严重性**: Low — 基本功能不受影响，但压缩相关元数据丢失

**当前代码** (`src/protocol/parsers.ts:110-113`):

```typescript
export function parseOpenResponse(body: Buffer): OpenResponse {
  const [fhandle] = getBytes(body, 0, 4);
  return { fhandle: new Uint8Array(fhandle) };
  // cpsize[4] and cptype[4] are ignored
}
```

**C++ 服务器响应格式** (`xrootd/src/XProtocol/XProtocol.hh`):

```cpp
struct ServerResponseBody_Open {
    kXR_char  fhandle[4];
    kXR_int32 cpsize;      // compress block size
    kXR_char  cptype[4];   // compress type ("zlib" etc.)
    // if kXR_retstat: followed by stat info string
};
```

**修改方案**:

```typescript
export interface OpenResponse {
  fhandle: Uint8Array;
  cpsize: number;   // compression block size (0 = no compression)
  cptype: string;   // compression type ("", "zlib", etc.)
}

export function parseOpenResponse(body: Buffer): OpenResponse {
  const [fhandle] = getBytes(body, 0, 4);
  const [cpsize] = get32(body, 4);
  const [cptypeRaw] = getBytes(body, 8, 4);
  const cptype = Buffer.from(cptypeRaw).toString("utf8").replace(/\0+$/, "");
  return { fhandle: new Uint8Array(fhandle), cpsize, cptype };
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/parsers.ts:25-27,110-113` | 扩展接口和解析逻辑 |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClXRootDMsgHandler.cc:1394-1430` — OpenResponse 解析
- `xrootd/src/XProtocol/XProtocol.hh` — ServerResponseBody_Open 定义

---

### 8. DirectoryEntry: 结构与 C++ binding 不一致

**严重性**: Low — 功能可用但信息不完整

**当前接口** (`src/api/types.ts:84-89`):

```typescript
export interface DirectoryEntry {
  name: string;
  size: number;
  flags: number;
  mtime: number;
}
```

**C++ binding 结构** (`xrootd-binding/src/handlers/FSComplexHandlers.hpp`):

```typescript
{
  name: string;
  hostAddress: string;   // ← 缺失
  stat: StatInfo | null; // ← 缺失 (dstat 时完整 stat 信息)
}
```

**说明**: C++ binding 的 DirListEntry 包含 `hostAddress` (文件所在服务器地址) 和完整的
`StatInfo` (当 dstat 启用时)。当前 TS 实现的 `size/flags/mtime` 只是 statinfo 的部分字段。

**修改方案**: Phase 2 可暂不修改此接口，因为:
- `hostAddress` 在普通 dirlist 中不存在
- 完整 `StatInfo` 需要 #1 和 #5 先修复
- 当前 `size/flags/mtime` 对于基本目录列表足够

后续可改为:

```typescript
export interface DirectoryEntry {
  name: string;
  hostAddress?: string;
  stat?: StatInfo;
}
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/api/types.ts:84-89` | 后续优化 |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:577-587` — ListEntry 包含 StatInfo

---

## P2 — Missing Constants

### 9. 缺少 StatFlags 常量

**严重性**: Medium — 用户无法正确使用 flags 位掩码

**当前状态**: `constants.ts` 中没有定义 XRootD stat flags，用户需要自行查找 magic numbers。

**C++ 定义** (`xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:792-802`):

```cpp
kXR_xset     = 1     // executable/searchable bit set
kXR_isDir    = 2     // is a directory
kXR_other    = 4     // neither file nor directory
kXR_offline  = 8     // file is offline (on tape etc.)
kXR_readable = 16    // read access allowed
kXR_writable = 32    // write access allowed
kXR_poscpend = 64    // POSC opened, not yet closed
kXR_bkpexist = 128   // backup copy exists
kXR_cachersp = 512   // response from cache
```

**修改方案** (`src/protocol/constants.ts`):

```typescript
// ── Stat Response Flags (kXR_stat body flags field) ────────────────────────
export const StatFlags = {
  XBitSet:     1,    // kXR_xset — executable/searchable bit set
  IsDir:       2,    // kXR_isDir — is a directory
  Other:       4,    // kXR_other — neither file nor directory
  Offline:     8,    // kXR_offline — file is offline (on tape etc.)
  Readable:    16,   // kXR_readable — read access allowed
  Writable:    32,   // kXR_writable — write access allowed
  POSCPending: 64,   // kXR_poscpend — POSC opened, not yet closed
  BackUpExists: 128, // kXR_bkpexist — backup copy exists
  CacheResp:   512,  // kXR_cachersp — response from cache
} as const;
export type StatFlags = typeof StatFlags[keyof typeof StatFlags];
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/constants.ts` | 添加 StatFlags 常量 |

**C++ 参考**:
- `xrootd/src/XrdXrootd/XrdXrootdProtocol.cc:792-802` — flags 计算
- `xrootd-binding/lib/enums.ts:73-82` — C++ binding 的 StatFlags 定义

---

### 10. 缺少 DirlistOptions 常量

**严重性**: Medium — 用户无法使用 dstat/dcksm 选项

**当前状态**: `buildDirlistRequest` 接受 `options: number = 0`，但没有定义选项常量。
用户需要知道 `kXR_dstat = 2` 等 magic numbers。

**C++ 定义** (`xrootd/src/XProtocol/XProtocol.hh:267-271`):

```cpp
enum XDirlistRequestOption {
   kXR_online = 1,
   kXR_dstat  = 2,
   kXR_dcksm  = 4,   // dcksm implies dstat irrespective of dstat setting
   kXR_dstatx = 8    // Return extended information, if available
};
```

**修改方案** (`src/protocol/constants.ts`):

```typescript
// ── Dirlist Options (kXR_dirlist options field) ────────────────────────────
export const DirlistOptions = {
  Online:  1,  // kXR_online — return only online entries
  Dstat:   2,  // kXR_dstat — return stat info for each entry
  Dcksm:   4,  // kXR_dcksm — return checksum (implies dstat)
  Dstatx:  8,  // kXR_dstatx — return extended stat info
} as const;
export type DirlistOptions = typeof DirlistOptions[keyof typeof DirlistOptions];
```

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/constants.ts` | 添加 DirlistOptions 常量 |

**C++ 参考**:
- `xrootd/src/XProtocol/XProtocol.hh:267-271` — XDirlistRequestOption 枚举

---

## P3 — Handshake Auth Integration

### 11. doAuthentication 未接入 connect 流程

**严重性**: Medium — 认证框架存在但未自动调用

**当前状态**:
- `src/session/auth.ts` 实现了 `doAuthentication()` 多轮认证循环
- `src/session/auth.ts:72-80` 已正确处理 `kXR_authmore` (4002) 响应
- `src/client.ts:53-56` 的 `doConnect()` 调用 `handshake()` 后**未调用** `doAuthentication()`

**问题**: 即使服务器要求认证，客户端也不会自动完成认证流程。

**修改方案** (`src/client.ts`):

```typescript
import { doAuthentication } from "./session/auth.ts";
import { registerAuthProtocol } from "./session/auth.ts";
import { HostAuth } from "./security/host.ts";
import { SSSAuth } from "./security/sss.ts";

// 在 doConnect 中:
private async doConnect(url: XRootDUrl): Promise<void> {
  // ... existing transport/mux setup ...

  this.session = await handshake(this.mux, url, {
    username: this.options.credentials?.username,
  });

  // 注册支持的认证协议
  registerAuthProtocol("host", () => new HostAuth());
  registerAuthProtocol("sss", () => new SSSAuth());

  // 如果服务器要求认证且有凭据，执行认证
  if (this.session.secReqs && this.options.credentials) {
    const secEntity = await doAuthentication(
      this.mux,
      this.session.secReqs,
      {
        host: url.host,
        port: url.port,
        username: this.options.credentials.username,
        password: this.options.credentials.password,
        sessid: this.session.sessid,
      },
    );
    this.session.secEntity = secEntity;
  }

  this.fs = new FileSystem(this.mux);
}
```

**同时需要**:
- `Session` 接口添加 `secEntity?: SecEntity` 字段
- `handshake.ts:22-27` 更新 Session 接口定义

**涉及文件**:
| 文件 | 修改内容 |
|------|----------|
| `src/client.ts:40-57` | 在 doConnect 中接入认证 |
| `src/session/handshake.ts:22-27` | Session 接口添加 secEntity |
| `src/client.ts:14-21` | XRootDClientOptions 可选添加 password |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClXRootDTransport.cc:2475-2693` — DoAuthentication 完整流程

---

## P4 — Missing Request Builders

### 12. 缺少 Ping/Chmod/Query/Locate 构建器

**严重性**: Low — Phase 2 核心功能已覆盖，这些是补充功能

**当前状态**: `constants.ts` 定义了这些 RequestId 但没有对应的构建器。

| 请求 | ID | 用途 | Phase 2 必要性 |
|------|-----|------|---------------|
| `Ping` | 3011 | 服务器健康检查 | 有用但非必须 |
| `Chmod` | 3002 | 修改文件权限 | 基础 FS 操作 |
| `Query` | 3001 | 查询服务器元数据 | 有用但非必须 |
| `Locate` | 3027 | 定位文件所在服务器 | 对重定向优化有用 |

**Locate 请求格式** (`xrootd/src/XProtocol/XProtocol.hh`):

```cpp
struct ClientLocateRequest {
    kXR_char  streamid[2];
    kXR_unt16 requestid;     // kXR_locate (3027)
    kXR_char  options[1];    // OpenFlags::Read/Write
    kXR_char  reserved[15];
    kXR_int32 dlen;          // path length
};
// Followed by path string
```

**Locate 响应格式** (空格分隔):

```
<locationType><accessType><address> ...
```

其中 `locationType`: M=ManagerOnline, m=ManagerPending, S=ServerOnline, s=ServerPending
`accessType`: r=Read, w=ReadWrite

**修改方案**: 仅在有明确使用场景时添加。Phase 2 可暂缓。

**涉及文件** (如需添加):
| 文件 | 修改内容 |
|------|----------|
| `src/protocol/builders.ts` | 添加构建器函数 |
| `src/protocol/parsers.ts` | 添加 Locate 响应解析 |
| `src/protocol/message.ts` | 导出新构建器/解析器 |
| `src/index.ts` | 导出新函数 |

**C++ 参考**:
- `xrootd/src/XrdCl/XrdClFileSystem.cc` — Locate/DeepLocate 实现
- `xrootd/src/XrdCl/XrdClXRootDResponses.cc:38-104` — LocationInfo 解析

---

## 不需要实现的项目

### kXR_statx (3022) 批量 stat

**结论**: 不需要实现。

- C++ 官方 XrdCl 客户端库从未使用 `kXR_statx`，所有 stat 操作均用 `kXR_stat` (3017)
- `statx` 仅返回每路径 1 字节状态 (isDir/isFile/isOffline)，不返回 size/mtime/id
- `kXR_stat` 已实现且返回完整元数据，功能完全覆盖
- 如果将来有批量路径检查的性能需求，实现非常简单 (发送换行分隔路径，读回每路径 1 字节)

**参考**: `xrootd/src/XrdXrootd/XrdXrootdXeq.cc:3172-3204` — do_Statx 实现

---

## 修改顺序建议

```
Phase 1 (Bug Fixes — must do first):
  #1  StatInfo flags 解析
  #2  StatInfo id/size 类型
  #3  Dirlist 普通格式解析
  #4  Dirlist dstat 格式解析

Phase 2 (Missing Data — depends on Phase 1):
  #5  StatInfo ctime/atime/owner/group
  #6  isOffline/isCached 实现
  #7  OpenResponse cpsize/cptype
  #9  StatFlags 常量
  #10 DirlistOptions 常量

Phase 3 (Integration — independent of Phase 1/2):
  #11 Handshake auth 集成

Phase 4 (Optional Enhancements):
  #8  DirectoryEntry 结构优化
  #12 Ping/Chmod/Query/Locate 构建器
```

---

## 测试文件清单

修改后需要同步更新的测试文件:

| 测试文件 | 需更新内容 |
|----------|-----------|
| `src/api/filesystem.test.ts` | StatInfo id/size 类型断言 |
| `src/api/file.test.ts` | StatInfo 相关断言 |
| `src/protocol/message.test.ts` | dirlist 解析测试用例 |
| `tests/integration/filesystem.integration.test.ts` | StatInfo 类型检查 |
| `tests/integration/file-read.integration.test.ts` | size 比较断言 |
| `tests/e2e/filesystem.test.ts` | dirlist 功能测试 |
