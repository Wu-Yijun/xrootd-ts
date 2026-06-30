# XrdPfc 模块分析报告

## 1. 模块概述

XrdPfc（XRootD Proxy File Cache）是 XRootD 框架中的**代理文件缓存**模块，以插件形式加载。它将远程文件缓存到本地磁盘，从而加速重复读取操作并降低网络负载。模块支持两种工作模式：

- **全文件预取模式**（默认）：文件打开时启动预取线程，按可配置的块大小（默认 1MB）顺序下载整个文件到本地磁盘。
- **HDFS 块级模式**（`pfc.hdfsmode`）：按需下载文件的特定块，每个块存储为独立文件，适用于 HDFS 等块存储系统。

每个缓存文件伴随一个 `.cinfo` 元数据文件，记录块下载状态位图、校验和信息、访问历史和统计信息，支持崩溃后恢复。

---

## 2. 文件列表与功能说明

### 构建与配置

| 文件 | 功能 |
|------|------|
| `CMakeLists.txt` | CMake 构建配置，定义三个动态库（XrdPfc、XrdBlacklistDecision、XrdPfcPurgeQuota）和一个可执行文件（xrdpfc_print） |
| `README` | 模块介绍文档，说明两种工作模式、配置参数和性能注意事项 |

### 核心类（XrdPfc 命名空间）

| 文件 | 功能 |
|------|------|
| `XrdPfc.hh` / `XrdPfc.cc` | **Cache 单例**——模块入口，继承自 `XrdOucCache`，管理缓存生命周期、文件打开/关闭、写队列、预取、RAM 内存池、配置解析，提供 `XrdOucGetCache` C 入口函数 |
| `XrdPfcFile.hh` / `XrdPfcFile.cc` | **File 类**——表示单个缓存文件，管理块映射、读请求分发、预取调度、同步（Sync）和磁盘写入 |
| `XrdPfcIO.hh` / `XrdPfcIO.cc` | **IO 基类**——继承自 `XrdOucCacheIO`，封装原始 I/O 对象，提供缓存 I/O 的公共接口（Detach、Update 等） |
| `XrdPfcIOFile.hh` / `XrdPfcIOFile.cc` | **IOFile 类**——继承 IO，将整个文件下载为单个本地文件，处理 Read/ReadV/Fstat 请求 |
| `XrdPfcIOFileBlock.hh` / `XrdPfcIOFileBlock.cc` | **IOFileBlock 类**——继承 IO，HDFS 块级模式实现，按需下载独立块文件 |
| `XrdPfcInfo.hh` / `XrdPfcInfo.cc` | **Info 类**——缓存文件的元数据管理器，维护块下载状态位图、校验和状态、访问统计（AStat）、.cinfo 文件的读写 |
| `XrdPfcConfiguration.cc` | Cache 的配置解析实现，解析 xrootd 配置文件中的 `pfc.*` 参数 |
| `XrdPfcCommand.cc` | 处理 `/xrdpfc_command/` URL 命令，支持 `create_file`（创建测试缓存文件）和 `remove_file`（删除缓存文件） |

### 决策插件系统

| 文件 | 功能 |
|------|------|
| `XrdPfcDecision.hh` | **Decision 基类**——定义缓存决策接口，决定文件是否应被缓存 |
| `XrdPfcAllowDecision.cc` | **AllowDecision 插件**——始终允许缓存的简单决策实现 |
| `XrdPfcBlacklistDecision.cc` | **BlacklistDecision 插件**——黑名单决策，按模式匹配拒绝缓存特定文件 |

### 资源监控与目录状态

| 文件 | 功能 |
|------|------|
| `XrdPfcResourceMonitor.hh` / `XrdPfcResourceMonitor.cc` | **ResourceMonitor 类**——资源监控器，管理文件打开/关闭/更新/清除事件队列，运行心跳循环，协调目录状态扫描和缓存清除 |
| `XrdPfcDirState.hh` / `XrdPfcDirState.cc` | **DirState 类**——目录状态树节点，维护目录级统计（DirStats/DirUsage），支持路径查找和状态向上传播 |
| `XrdPfcDirStateBase.hh` | DirState 的基类定义，包含 DirUsage 结构和 DataFsStateBase |
| `XrdPfcDirStateSnapshot.hh` / `XrdPfcDirStateSnapshot.cc` | 目录状态快照导出，将树形 DirState 导出为向量形式（DirStateElement/DataFsSnapshot），供外部工具处理 |
| `XrdPfcDirStatePurgeshot.hh` | 清除快照定义（DirPurgeElement/DataFsPurgeshot），用于缓存清除决策 |
| `XrdPfcFPurgeState.hh` / `XrdPfcFPurgeState.cc` | **FPurgeState 类**——文件级清除状态管理，遍历文件系统收集待清除文件候选 |

### 文件系统遍历

| 文件 | 功能 |
|------|------|
| `XrdPfcFsTraversal.hh` / `XrdPfcFsTraversal.cc` | **FsTraversal 类**——文件系统遍历器，支持目录树遍历、目录进入/退出、文件配对统计（数据文件 + .cinfo） |

### 清除插件

| 文件 | 功能 |
|------|------|
| `XrdPfcPurgePin.hh` | **PurgePin 基类**——清除配额插件接口，定义 `GetBytesToRecover` 虚函数 |
| `XrdPfcPurgeQuota.cc` | **XrdPfcPurgeQuota 插件**——基于目录配额的清除实现，解析配额文件，计算各目录需回收的字节数 |
| `XrdPfcPurge.cc` | 清除逻辑实现（Purge 算法） |

### 文件系统控制

| 文件 | 功能 |
|------|------|
| `XrdPfcFSctl.hh` / `XrdPfcFSctl.cc` | **XrdPfcFSctl 类**——继承 `XrdOfsFSctl_PI`，处理文件系统控制命令（如 `ConsiderCached` 检查文件是否已缓存） |

### 统计与类型定义

| 文件 | 功能 |
|------|------|
| `XrdPfcStats.hh` | **Stats/DirStats 类**——缓存统计信息（字节命中/未命中/绕过、写入量、校验和错误等），支持增量和合并操作 |
| `XrdPfcTypes.hh` | 基本类型定义：CkSumCheck_e 枚举（校验和检查模式）、vCkSum_t 向量类型 |
| `XrdPfcTrace.hh` | TRACE 宏定义，提供分级日志输出（Error/Warning/Info/Debug/Dump） |

### 工具类

| 文件 | 功能 |
|------|------|
| `XrdPfcPathParseTools.hh` | 路径解析工具：SplitParser（字符串分割器）和 PathTokenizer（路径分词器） |

### 独立可执行文件

| 文件 | 功能 |
|------|------|
| `XrdPfcPrint.hh` / `XrdPfcPrint.cc` | **xrdpfc_print 工具**——独立命令行程序，读取并打印 .cinfo 文件内容，支持普通文本和 JSON 格式输出 |

---

## 3. 重要文件详细结构分析

### 3.1 XrdPfc.hh / XrdPfc.cc — Cache 单例

**类层次**：`Cache` 继承自 `XrdOucCache`（XRootD 缓存抽象基类）

**核心功能模块**：

1. **配置系统**（`Configuration` 结构体）
   - 磁盘空间管理：`m_diskTotalSpace`、`m_diskUsageLWM`/`HWM`（低/高水位线）
   - 文件使用限制：`m_fileUsageBaseline`/`Nominal`/`Max`
   - 缓冲区配置：`m_bufferSize`（块大小，默认 128KB）
   - 写队列：`m_wqueue_blocks`/`m_wqueue_threads`
   - 预取：`m_prefetch_max_blocks`
   - 校验和：`m_cs_Chk`（检查模式）、`m_cs_UVKeep`（未验证缓存保留时间）
   - HTTP 缓存控制：`m_httpcc`

2. **文件生命周期管理**
   - `m_active`（ActiveMap_t）：当前打开/活跃文件的映射
   - `m_purge_delay_set`：延迟清除的文件集合
   - `GetFile()` / `ReleaseFile()`：文件获取和释放
   - 引用计数：`inc_ref_cnt()` / `dec_ref_cnt()`
   - 紧急关闭：`initiate_emergency_shutdown()`

3. **写队列系统**
   - `WriteQ` 结构体：条件变量 + 链表队列
   - `AddWriteTask()`：将 Block 加入写队列
   - `ProcessWriteTasks()`：多个写线程从队列取 Block 写入磁盘
   - `RemoveWriteQEntriesFor()`：文件销毁时移除其所有写任务

4. **RAM 内存管理**
   - `RequestRAM()` / `ReleaseRAM()`：对齐内存块的申请和释放
   - `m_RAM_std_blocks`：标准大小内存块缓存池，减少频繁分配

5. **预取系统**
   - `RegisterPrefetchFile()` / `DeRegisterPrefetchFile()`：注册/注销预取文件
   - `Prefetch()`：预取线程主循环，选择文件执行预取
   - `GetNextFileToPrefetch()`：随机选择下一个预取文件

6. **缓存控制**
   - `LocalFilePath()`：获取本地缓存文件路径
   - `Prepare()`：延迟打开，检查 .cinfo 是否存在
   - `Stat()`：从缓存返回文件状态
   - `Unlink()` / `UnlinkFile()`：删除缓存文件
   - `ConsiderCached()`：判断文件是否被视为已缓存（支持 only-if-cached）

**入口函数**：`XrdOucGetCache()` — C 链接的工厂函数，XRootD 通过此函数加载缓存插件。

### 3.2 XrdPfcFile.hh — File 类

**核心职责**：管理单个缓存文件的状态和 I/O

**关键数据结构**：
- `m_block_map`（BlockMap_t）：按偏移索引的块映射
- `m_io_set`（IoSet_t）：附加到此文件的 IO 对象集合
- `m_cfi`（Info）：文件元数据和块状态
- `m_prefetch_state`：预取状态机（Off/On/Hold/Stopped/Complete）

**关键方法**：
- `FileOpen()`：静态工厂方法，创建并打开文件
- `Read()` / `ReadV()`：处理读请求，分发到已有块或发起网络请求
- `Prefetch()`：预取下一块
- `Sync()`：将信息文件同步到磁盘
- `WriteBlockToDisk()`：将单个块写入数据文件

### 3.3 XrdPfcInfo.hh — Info 类

**缓存文件的元数据管理器**，维护 .cinfo 文件内容：

**存储结构**：
- `m_buff_written`：块下载状态位图（每个 bit 对应一个块）
- `m_buff_synced`：块同步状态位图
- `m_buff_prefetch`：预取统计位图
- `m_astats`：访问历史记录数组（AStat 向量）
- `m_store`：核心元数据（块大小、文件大小、创建时间、校验和状态等）

**校验和管理**：
- `CkSumCheck_e` 枚举：None/Cache/Net/Both
- 位级操作：`SetBitWritten()`、`TestBitWritten()`、`SetBitSynced()`

### 3.4 XrdPfcResourceMonitor.hh — ResourceMonitor 类

**资源监控器**，负责：
- 维护双缓冲事件队列（写队列/读队列）
- 处理文件打开/关闭/统计更新/清除事件
- 运行心跳循环（heart_beat）
- 协调目录状态扫描
- 执行缓存清除检查

---

## 4. 模块依赖关系

### 4.1 XrdPfc 依赖的模块

从 `CMakeLists.txt` 的 `target_link_libraries` 和源码 `#include` 分析：

| 依赖模块 | 用途 |
|----------|------|
| **XrdCl** | 客户端库，用于 URL 解析（XrdClURL）、文件系统查询（FileSystem）、远程文件访问 |
| **XrdUtils** | 通用工具库 |
| **XrdServer** | 服务端基础设施 |
| **XrdPosix** | POSIX 兼容层，`XrdPosixExtra::FSctl` 用于文件系统查询 |
| **XrdOss** | 对象存储系统接口（`XrdOss`/`XrdOssDF`），用于本地磁盘文件操作 |
| **XrdOuc** | 通用缓存框架（`XrdOucCache`/`XrdOucCacheIO`）、配置流（`XrdOucStream`）、环境（`XrdOucEnv`）、JSON（`XrdOucJson`） |
| **XrdSys** | 系统工具：线程（XrdSysPthread）、条件变量、定时器、跟踪（XrdSysTrace）、扩展属性（XrdSysXAttr） |
| **Xrd** | 调度器（XrdScheduler） |
| **XrdXrootd** | GStream（`XrdXrootdGStream`），用于事件流式传输 |
| **XrdOfs** | 文件系统控制插件接口（`XrdOfsFSctl_PI`） |
| **nlohmann/json** | JSON 解析库，用于 HTTP Cache-Control 处理 |

### 4.2 依赖 XrdPfc 的模块

从 XRootD 项目的整体架构和安装的头文件分析：

| 依赖模块 | 关系 |
|----------|------|
| **XrdPosix** | XrdPosix 层通过 `XrdOucCache` 接口调用 XrdPfc 的 `Attach`/`LocalFilePath` 等方法 |
| **XrdOfs** | OFS 层通过 `XrdOfsFSctl_PI` 接口使用 `XrdPfcFSctl` 处理缓存相关控制命令 |
| **XrdHttpTpc** | HTTP 第三方拷贝模块可能查询缓存状态 |
| **客户端应用** | 通过 `pps.cachelib libXrdPfc.so` 配置加载 |

安装的公共头文件（供外部模块使用）：
- `XrdPfc.hh` — Cache 接口
- `XrdPfcFile.hh` — File 和 Block 类型
- `XrdPfcInfo.hh` — Info 元数据类
- `XrdPfcTypes.hh` — 基本类型定义
- `XrdPfcStats.hh` — 统计信息
- `XrdPfcDecision.hh` — 决策插件接口
- `XrdPfcPurgePin.hh` — 清除插件接口
- `XrdPfcDirStateBase.hh` — 目录状态基类
- `XrdPfcDirStatePurgeshot.hh` — 清除快照
- `XrdPfcPathParseTools.hh` — 路径解析工具

---

## 5. 构建产物

| 产物 | 类型 | 说明 |
|------|------|------|
| `libXrdPfc-<ver>.so` | 动态库 | 主缓存插件 |
| `libXrdFileCache-<ver>.so` | 符号链接 | 指向 libXrdPfc，兼容旧名称 |
| `libXrdBlacklistDecision-<ver>.so` | 动态库 | 黑名单决策插件 |
| `libXrdPfcPurgeQuota-<ver>.so` | 动态库 | 配额清除插件 |
| `xrdpfc_print` | 可执行文件 | .cinfo 文件打印工具 |

---

## 6. 线程模型

XrdPfc 在初始化时启动以下线程：

1. **ResourceMonitor 线程** — 运行心跳循环，处理事件队列，执行缓存清除
2. **WriteTask 线程**（可配置数量） — 从写队列取 Block 并写入磁盘
3. **Prefetch 线程**（可选） — 当启用预取时运行，选择文件进行预取

所有线程通过条件变量和互斥锁进行同步。

---

## 7. 配置参数速查

| 参数 | 说明 |
|------|------|
| `pfc.blocksize` | 预取缓冲区大小（默认 128KB） |
| `pfc.ram` | 最大 RAM 使用量 |
| `pfc.prefetch` | 预取级别（最大块数） |
| `pfc.diskusage <low> <high>` | 磁盘使用水位线 |
| `pfc.user` | OSS 用户名 |
| `pfc.hdfsmode` | 启用块级模式 |
| `pfc.osslib` | 替代 OSS 插件路径 |
| `pfc.decisionlib` | 决策插件路径 |
| `pfc.trace` | 日志级别 |
| `pfc.writecksum` | 校验和检查模式 |
| `pfc.httpcc` | 启用 HTTP Cache-Control |
| `pfc.command` | 启用 /xrdpfc_command/ 功能 |
