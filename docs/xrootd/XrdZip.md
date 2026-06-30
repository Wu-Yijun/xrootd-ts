# XrdZip 模块分析

## 1. 模块概述

XrdZip 是 XRootD 项目中的一个**纯头文件库（header-only）**，位于 `xrootd/src/XrdZip/` 目录下。该模块实现了 **ZIP 文件格式的数据结构定义、解析和序列化功能**，为 XRootD 中需要处理 ZIP 归档文件的模块提供底层 ZIP 格式支持。

该模块遵循 ZIP 规范（包括 ZIP64 扩展），能够处理标准 ZIP 文件和 ZIP64 格式的大文件。

## 2. 文件列表与功能说明

| 文件名 | 一句话描述 |
|--------|-----------|
| `XrdZipUtils.hh` | 基础工具类：提供字节序转换、缓冲区操作、溢出检测、DOS 时间戳生成等底层工具函数 |
| `XrdZipExtra.hh` | ZIP64 扩展字段（Extra Field）数据结构：处理 ZIP64 格式中的大文件偏移、大小等扩展信息 |
| `XrdZipLFH.hh` | 本地文件头（Local File Header）数据结构：表示 ZIP 归档中每个文件的本地头部记录 |
| `XrdZipCDFH.hh` | 中央目录文件头（Central Directory File Header）数据结构：表示 ZIP 归档的中央目录记录 |
| `XrdZipEOCD.hh` | 中央目录结束记录（End of Central Directory）数据结构：表示 ZIP 归档尾部的结束标记 |
| `XrdZipZIP64EOCD.hh` | ZIP64 中央目录结束记录：ZIP64 格式对 EOCD 的扩展，支持超过 4GB 的文件 |
| `XrdZipZIP64EOCDL.hh` | ZIP64 中央目录结束记录定位器：用于定位 ZIP64 EOCD 记录的位置 |
| `XrdZipDataDescriptor.hh` | 数据描述符（Data Descriptor）：用于描述压缩数据的大小和校验信息 |

## 3. ZIP 文件格式结构说明

XrdZip 模块实现了标准 ZIP 文件格式的核心数据结构：

```
+---------------------------+
|  Local File Header (LFH)  |  ← XrdZipLFH.hh
|  文件名 + 压缩数据         |
+---------------------------+
|  ... 重复多个文件 ...       |
+---------------------------+
|  Central Directory (CDFH) |  ← XrdZipCDFH.hh
|  文件索引/目录信息          |
+---------------------------+
|  ZIP64 End of CD (可选)    |  ← XrdZipZIP64EOCD.hh
|  ZIP64 End of CD Locator  |  ← XrdZipZIP64EOCDL.hh
|  End of Central Directory |  ← XrdZipEOCD.hh
+---------------------------+
```

## 4. 重要文件详细分析

### 4.1 XrdZipUtils.hh — 基础工具层

**核心功能：**

- **字节序处理**：`copy_bytes()` 和 `from_buffer()` 模板函数处理小端（little-endian）字节序，自动检测大端系统并进行字节反转
- **溢出检测**：`ovrflw<UINT>` 模板结构体提供无符号整型的最大值（-1），用于判断 ZIP64 扩展是否必要
- **异常定义**：`bad_data` 异常类用于表示 ZIP 数据损坏
- **DOS 时间戳**：`dos_timestmp` 结构体将 `time_t` 转换为 ZIP 格式使用的 DOS 时间戳格式（时/分/秒/年/月/日）

**关键类型定义：**
- `buffer_t`：`std::vector<char>` 的别名，作为所有序列化操作的缓冲区类型

### 4.2 XrdZipLFH.hh — 本地文件头

**核心功能：** 定义 ZIP 归档中每个文件的本地文件头记录（Local File Header），这是 ZIP 文件中每个文件数据块前的头部信息。

**关键字段：**
- `minZipVersion`：解压所需的最低 ZIP 版本
- `compressionMethod`：压缩方法（0=存储，8=Deflate）
- `timestmp`：DOS 时间戳
- `ZCRC32`：CRC32 校验值
- `compressedSize` / `uncompressedSize`：压缩/未压缩大小
- `filename`：文件名
- `extra`：ZIP64 扩展字段（当文件超过 4GB 时使用）

**关键方法：**
- `LFH(filename, crc, fileSize, time)`：从文件信息构造 LFH
- `LFH(buffer, bufferSize)`：从缓冲区解析 LFH
- `Serialize(buffer)`：将 LFH 序列化到缓冲区

**签名常量：** `lfhSign = 0x04034b50`，`lfhBaseSize = 30` 字节

### 4.3 XrdZipCDFH.hh — 中央目录文件头

**核心功能：** 定义 ZIP 归档的中央目录文件头记录（Central Directory File Header），这是 ZIP 文件尾部的文件索引信息。

**关键字段：** 与 LFH 类似，额外包含：
- `zipVersion`：创建 ZIP 时使用的版本
- `externAttr`：外部属性（如文件权限 `mode << 16`）
- `offset`：文件在 ZIP 中的偏移量
- `commentLength` / `comment`：文件注释

**关键方法：**
- `Parse(buffer, bufferSize, nbCdRecords)`：批量解析中央目录记录
- `Parse(buffer, bufferSize)`：从缓冲区连续解析所有 CDFH 记录
- `CalcSize(cdvec, orgcdsz, orgcdcnt)`：计算新增 CDFH 记录的总大小
- `Serialize(orgcdcnt, orgcdbuf, cdvec, buffer)`：序列化原始和新增的 CDFH 记录
- `ParseExtra(buffer, length)`：解析 ZIP64 扩展字段
- `GetOffset(cdfh)`：获取正确的偏移量（支持 ZIP64）

**类型定义：**
- `cdvec_t`：CDFH 记录向量
- `cdmap_t`：文件名到 CDFH 索引的映射
- `cdrecs_t`：文件名到 CDFH 记录的映射

**签名常量：** `cdfhSign = 0x02014b50`，`cdfhBaseSize = 46` 字节

### 4.4 XrdZipEOCD.hh — 中央目录结束记录

**核心功能：** 定义 ZIP 归档末尾的中央目录结束记录（End of Central Directory），标记中央目录的结束位置。

**关键字段：**
- `nbDisk`：当前磁盘编号
- `nbDiskCd`：中央目录所在磁盘编号
- `nbCdRecD` / `nbCdRec`：中央目录记录总数
- `cdSize`：中央目录总大小
- `cdOffset`：中央目录在 ZIP 文件中的偏移
- `commentLength` / `comment`：ZIP 注释

**关键方法：**
- `Find(buffer, size)`：从缓冲区末尾向前搜索 EOCD 签名（从 `size - 22` 开始倒序搜索）
- `EOCD(cdoff, cdcnt, cdsize)`：从偏移/记录数/大小构造 EOCD
- `Serialize(buffer)`：序列化到缓冲区

**签名常量：** `eocdSign = 0x06054b50`，`eocdBaseSize = 22` 字节

### 4.5 XrdZipExtra.hh — ZIP64 扩展字段

**核心功能：** 处理 ZIP64 格式的扩展字段（Extra Field），当文件大小或偏移量超过 32 位限制时使用。

**关键字段：**
- `uncompressedSize` / `compressedSize`：64 位文件大小
- `offset`：64 位偏移量
- `nbDisk`：磁盘编号
- `totalSize`：扩展字段总大小

**溢出标志位（Ovrflw 枚举）：**
- `NONE = 0`：无溢出
- `UCMPSIZE = 1`：未压缩大小溢出
- `CPMSIZE = 2`：压缩大小溢出
- `OFFSET = 4`：偏移量溢出
- `NBDISK = 8`：磁盘编号溢出

**关键方法：**
- `Find(buffer, length)`：在 extra 字段中查找 ZIP64 扩展（headerID = 0x0001）
- `FromBuffer(buffer, exsize, flags)`：从缓冲区解析 ZIP64 扩展
- `Serialize(buffer)`：序列化到缓冲区

### 4.6 XrdZipZIP64EOCD.hh — ZIP64 中央目录结束记录

**核心功能：** ZIP64 格式的中央目录结束记录，当 ZIP 文件超过 4GB 或包含超过 65535 个文件时使用。

**关键字段：** 使用 64 位字段存储：
- `nbCdRecD` / `nbCdRec`：64 位记录总数
- `cdSize`：64 位中央目录大小
- `cdOffset`：64 位偏移量

**签名常量：** `zip64EocdSign = 0x06064b50`，`zip64EocdBaseSize = 56` 字节

### 4.7 XrdZipZIP64EOCDL.hh — ZIP64 中央目录结束记录定位器

**核心功能：** 定位 ZIP64 EOCD 记录的位置，作为标准 EOCD 到 ZIP64 EOCD 之间的桥梁。

**关键字段：**
- `nbDiskZip64Eocd`：ZIP64 EOCD 所在磁盘
- `zip64EocdOffset`：ZIP64 EOCD 的偏移量
- `totalNbDisks`：磁盘总数

**签名常量：** `zip64EocdlSign = 0x07064b50`，`zip64EocdlSize = 20` 字节

### 4.8 XrdZipDataDescriptor.hh — 数据描述符

**核心功能：** 定义 ZIP 数据描述符记录，用于在流式写入时记录压缩数据的大小和校验信息。

**关键常量：**
- `flag = 1 << 3`：数据描述符标志位（bit 3）
- `sign = 0x08074b50`：数据描述符签名

**关键方法：**
- `GetSize(zip64)`：根据 ZIP64 模式返回描述符大小（ZIP64: 24 字节，标准: 16 字节）

## 5. 模块依赖关系

### 5.1 XrdZip 依赖的模块

| 依赖模块 | 依赖文件 | 说明 |
|---------|---------|------|
| **XrdSys** | `XrdSys/XrdSysPlatform.hh` | 平台兼容性定义，如大端检测（`Xrd_Big_Endian`）、字节交换函数（`bswap`）等 |

XrdZip 是一个非常独立的模块，仅依赖 XrdSys 提供的平台抽象层，**不依赖任何其他 XRootD 模块**。

### 5.2 依赖 XrdZip 的模块

| 模块 | 使用文件 | 使用方式 |
|------|---------|---------|
| **XrdCl** | `XrdClZipArchive.hh`、`XrdClZipArchive.cc` | 使用所有 XrdZip 头文件，实现 ZIP 归档文件的远程读取功能。通过 `using namespace XrdZip` 直接使用 LFH、CDFH、EOCD、ZIP64_EOCD、ZIP64_EOCDL 等数据结构进行 ZIP 文件的解析 |
| **XrdEc** | `XrdEcReader.cc`、`XrdEcStrmWriter.cc` | 使用 LFH、CDFH、EOCD、Utils 等头文件。Reader 用 LFH 解析元数据并验证 CRC32，用 CDFH 解析中央目录；StrmWriter 构建 LFH/CDFH/EOCD 记录来生成 ZIP 格式的元数据缓冲区 |

### 5.3 依赖关系图

```
XrdSys (平台抽象)
  └── XrdZip (ZIP 格式处理，纯头文件库)
        ├── XrdCl (客户端库，ZIP 归档读取)
        └── XrdEc (纠删码模块，ZIP 元数据读写)
```

## 6. 设计特点

1. **纯头文件库**：所有实现均在 `.hh` 头文件中以 `inline` 或模板形式提供，无需单独编译，不需要 CMakeLists.txt
2. **Header-only 设计**：模块无需链接，使用方直接 `#include` 即可
3. **ZIP64 全面支持**：通过 `Extra` 扩展字段机制，完整支持超过 4GB 的文件和超过 65535 个文件的 ZIP 归档
4. **小端序设计**：默认按小端字节序处理，大端系统自动转换
5. **异常安全**：通过 `bad_data` 异常处理损坏的 ZIP 数据
6. **零拷贝解析**：使用 `from_buffer()` 和 `to<>()` 模板函数直接从缓冲区读取数据，避免不必要的内存分配
