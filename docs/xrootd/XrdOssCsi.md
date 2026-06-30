# XrdOssCsi 模块分析

## 1. 模块概述

XrdOssCsi 是 XRootD 的一个**堆叠式 OSS（Object Storage System）插件**，其核心功能是为文件系统添加**文件系统级校验和（XRDOSS_HASFSCS）**支持。它通过为每个数据文件维护一个独立的"标签文件"（tag file），存储每个页面（page）的 CRC32C 校验值，从而实现数据完整性验证。

当进行 `Write()` 或 `Read()` 调用时，插件会自动更新或校验存储的 CRC32C 值。`pgWrite()` 和 `pgRead()` 接口则可直接读写这些校验值。

**版权归属**：CERN（欧洲核子研究中心），采用 LGPL v3 许可证。

## 2. 文件列表及简要说明

| 文件名 | 简要描述 |
|--------|----------|
| `CMakeLists.txt` | 构建配置文件，定义模块编译目标和依赖 |
| `README.md` | 模块使用说明文档 |
| `XrdOssCsi.hh` | 主头文件，定义 XrdOssCsi、XrdOssCsiFile、XrdOssCsiDir 核心类 |
| `XrdOssCsi.cc` | 主实现文件，OSS 插件入口、文件/目录操作、初始化逻辑 |
| `XrdOssCsiFile.cc` | 文件操作的具体实现（Open/Read/Write/pgRead/pgWrite 等） |
| `XrdOssHandler.hh` | 链式责任模式（Chain-of-Responsibility）基类，提供默认委托实现 |
| `XrdOssCsiConfig.hh` | 配置类头文件，包含 TagPath 路径映射和 XrdOssCsiConfig 配置管理 |
| `XrdOssCsiConfig.cc` | 配置解析实现，读取配置文件和命令行参数 |
| `XrdOssCsiPages.hh` | 页面管理器头文件，核心的 CRC32C 校验逻辑所在 |
| `XrdOssCsiPages.cc` | 页面管理器实现（对齐读写的 CRC 校验、truncate、一致性检查等） |
| `XrdOssCsiPagesUnaligned.cc` | 非对齐读写的 CRC 校验实现（部分页读写的复杂处理） |
| `XrdOssCsiTagstore.hh` | 标签存储抽象接口（纯虚基类） |
| `XrdOssCsiTagstoreFile.hh` | 基于文件的标签存储实现头文件 |
| `XrdOssCsiTagstoreFile.cc` | 标签文件的打开、读写、截断、字节序处理实现 |
| `XrdOssCsiRanges.hh` | 范围锁（Range Lock）机制头文件，用于并发页面级锁定 |
| `XrdOssCsiRanges.cc` | 范围锁管理实现，包括 Guard 释放逻辑 |
| `XrdOssCsiCrcUtils.hh` | CRC32C 工具函数头文件（combine、split、extendwith_zero） |
| `XrdOssCsiCrcUtils.cc` | CRC32C 工具函数实现，包含全零页面常量 |
| `XrdOssCsiFileAio.hh` | 异步 I/O（AIO）操作类定义，处理异步读写调度 |
| `XrdOssCsiFileAio.cc` | 异步 I/O 的调度和完成回调实现 |
| `XrdOssCsiTrace.hh` | 调试跟踪宏定义（TRACE、DEBUG、EPNAME 等） |

## 3. 架构设计

### 3.1 整体架构（堆叠式插件）

```
用户请求 → XrdOssCsi (OSS 插件层)
              │
              ├── XrdOssCsiDir  → 底层 OSS (successor_)
              ├── XrdOssCsiFile → 底层 OSS (successor_)
              │                    │
              │                    ├── XrdOssCsiPages (CRC 校验管理)
              │                    │     │
              │                    │     └── XrdOssCsiTagstore (标签存储)
              │                    │           └── XrdOssCsiTagstoreFile (文件实现)
              │                    │
              │                    └── XrdOssCsiRanges (并发范围锁)
              │
              └── XrdOssCsiConfig (配置管理)
```

### 3.2 关键类说明

#### `XrdOssCsi`（主 OSS 插件类）
- 继承自 `XrdOssHandler`，作为链式责任模式的顶层
- 管理 `XrdOssCsiDir` 和 `XrdOssCsiFile` 的创建
- 实现 `Init()` 初始化、`Features()` 特性声明
- 处理 `Unlink`、`Rename`、`Truncate`、`Create` 等文件系统操作
- 在 `Rename` 时同时重命名标签文件，保持数据一致性

#### `XrdOssCsiFile`（文件操作类）
- 继承自 `XrdOssDFHandler`，包装底层文件描述符
- 实现所有文件 I/O 操作：`Read`、`Write`、`pgRead`、`pgWrite` 等
- 使用 `puMapItem_t` 和静态 `pumap_` 实现文件级共享 Pages 对象
- 引用计数管理多个并发文件句柄共享同一 Pages 实例

#### `XrdOssCsiPages`（页面校验管理器）
- 核心类，管理每个页面的 CRC32C 校验值
- 区分**对齐操作**和**非对齐操作**（非对齐需要读-修改-写）
- `UpdateRange()`：写操作时更新 CRC 值
- `VerifyRange()`：读操作时验证 CRC 值
- `FetchRange()`/`StoreRange()`：pgRead/pgWrite 直接操作 CRC 值
- `BasicConsistencyCheck()`：打开文件时的一致性检查和修复

#### `XrdOssCsiTagstoreFile`（标签文件存储）
- 标签文件格式：20 字节头部 + N * 4 字节 CRC32C 值
- 头部包含：4 字节魔数（0x30544452 "RDT0"）、8 字节跟踪长度、4 字节标志、4 字节 CRC
- 支持跨平台字节序处理

#### `XrdOssCsiRanges`（范围锁）
- 基于页面粒度的读写锁机制
- 支持只读操作的并发（读-读不互斥，读-写互斥，写-写互斥）
- 使用条件变量实现阻塞等待

#### `XrdOssCsiCrcUtils`（CRC 工具）
- `crc32c_combine()`：合并两个连续数据块的 CRC
- `crc32c_split1()`/`split2()`：从组合 CRC 中分离出部分 CRC
- `crc32c_extendwith_zero()`：在 CRC 后追加零字节

### 3.3 标签文件组织方式

- **默认模式**（`prefix=/.xrdt`）：标签文件存储在 `/.xrdt` 目录下，路径结构与数据文件一致，例如数据文件 `/data/file.txt` 对应标签文件 `/.xrdt/data/file.txt.xrdt`
- **内联模式**（`prefix=`）：标签文件存储在与数据文件相同的目录中，以 `.xrdt` 为后缀
- 通过 `TagPath` 类进行路径映射

## 4. 构建配置

```cmake
# 构建目标：共享库模块
add_library(XrdOssCsi MODULE ...)

# 依赖：XrdUtils 和 XrdServer
target_link_libraries(XrdOssCsi PRIVATE XrdUtils XrdServer)

# 安装到标准库目录
install(TARGETS XrdOssCsi LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
```

## 5. 依赖关系

### 5.1 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdUtils` | 基础工具库 |
| `XrdServer` | 服务端基础设施（XrdScheduler、XrdJob 等） |
| `XrdOss` | OSS 抽象接口（XrdOss、XrdOssDF） |
| `XrdOuc` | 工具类（XrdOucCRC、XrdOucEnv、XrdOucStream 等） |
| `XrdSys` | 系统工具（XrdSysLogger、XrdSysMutex、XrdSysPageSize 等） |
| `XrdSfs` | 文件系统抽象（XrdSfsAio） |
| `Xrd` | 调度器（XrdScheduler、XrdJob） |
| `XrdVersion` | 版本信息宏 |

### 5.2 依赖该模块的模块

- **Xcache（PFC）**：当启用 `pfc.cschk cache` 时，XrdOssCsi 会作为缓存完整性检查的底层插件自动加载
- **独立服务器**：通过 `ofs.osslib ++ /usr/lib64/libXrdOssCsi.so` 配置加载

## 6. 配置选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `nofill` | false | 跳过为隐含零页面写入 CRC 值（文件孔洞不填充） |
| `nomissing` | false | 要求已存在数据文件必须有对应的标签文件 |
| `space=name` | `public` | 标签文件使用的 OSS 空间名 |
| `prefix=/dir` | `/.xrdt` | 标签文件的存储基目录 |
| `nopgextend` | false | 禁止 pgWrite 写入超出当前 EOF |
| `noloosewrites` | false | 禁用非对齐写入时的一致性恢复检查 |
| `csi.trace` | 0 | 调试跟踪级别 |

## 7. 数据流说明

### 7.1 写入流程（Write）

1. 获取页面范围锁（`LockTrackinglen`）
2. 计算或接收 CRC32C 值，更新标签文件（`UpdateRange` → `StoreRangeAligned`/`StoreRangeUnaligned`）
3. 调用底层 OSS 写入实际数据
4. 如写入失败，同步文件大小（`resyncSizes`）

### 7.2 读取流程（Read）

1. 获取页面范围锁（只读模式）
2. 调用底层 OSS 读取数据
3. 从标签文件读取 CRC32C 值，与读取数据计算的 CRC 进行比对验证（`VerifyRange`）
4. 如 CRC 不匹配，返回 `-EDOM` 错误

### 7.3 异步 I/O 流程

异步操作通过 `XrdOssCsiFileAio` 和 `XrdOssCsiFileAioJob` 实现两阶段调度：
- **阶段1**：获取范围锁，提交底层异步 I/O
- **阶段2**：I/O 完成后，执行 CRC 校验/更新

## 8. 并发控制

- **范围锁**（`XrdOssCsiRanges`）：基于页面粒度的读写锁，支持多读单写
- **跟踪长度锁**（`tscond_`）：保护文件大小跟踪信息的并发访问
- **页面映射锁**（`pumtx_`）：保护文件到 Pages 对象映射表的并发访问
- **异步 I/O 计数**（`aioCnt_`）：使用条件变量等待所有异步操作完成
