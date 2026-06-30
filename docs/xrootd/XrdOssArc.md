# XrdOssArc 模块分析报告

## 1. 模块概述

`XrdOssArc` 是 XRootD 存储系统的一个**归档存储系统插件**（OSS Plugin），以 `MODULE`（动态链接库）形式构建。该模块作为 XRootD OSS 层的**包装器（Wrapper）**，在底层存储系统之上提供了 **ZIP 归档文件管理、数据集备份、磁带存储预取（Staging）以及文件系统监控** 等能力。

核心设计理念：
- 采用 **装饰器/包装器模式**，通过继承 `XrdOssWrapper` 和 `XrdOssWrapDF`，在不修改底层 OSS 的前提下拦截和增强文件/目录操作
- 将数据集（Dataset）文件打包为 ZIP 归档文件存储在磁带缓冲区中
- 通过 Rucio 数据管理系统进行元数据管理和备份调度
- 支持从磁带/MSS 系统透明地恢复（Stage）文件

## 2. 文件列表与简要说明

| 文件名 | 作用描述 |
|--------|---------|
| `CMakeLists.txt` | 构建配置，定义编译目标和依赖库 |
| `XrdOssArc.hh / .cc` | 模块入口类，实现 OSS Wrapper 接口，分发文件/目录操作 |
| `XrdOssArcConfig.hh / .cc` | 配置管理器，解析 `ossarc.*` 配置指令，管理所有运行参数 |
| `XrdOssArcCompose.hh / .cc` | 路径合成器，解析 `/archive/` 和 `/backup/` 路径，提取 DSN/Scope/文件名 |
| `XrdOssArcFile.hh / .cc` | 归档文件操作类，封装对 ZIP 归档内成员文件的 Open/Read/Write/Fstat/Close |
| `XrdOssArcDir.hh / .cc` | 归档目录操作类，支持打开归档路径下的目录 |
| `XrdOssArcStage.hh / .cc` | 预取/调度模块，将磁带上的归档文件拉取到本地磁盘缓存 |
| `XrdOssArcBackup.hh / .cc` | 备份调度与执行，管理工作队列、Worker 线程，将数据集打包为归档 |
| `XrdOssArcFSMon.hh / .cc` | 文件系统空间监控器，周期性检查磁盘空间并控制备份准入 |
| `XrdOssArcStopMon.hh / .cc` | 停止信号监控器，通过检测 STOP 文件实现优雅停止/恢复 |
| `XrdOssArcZipFile.hh / .cc` | ZIP 文件操作封装，使用 libzip 库读取归档成员文件 |
| `XrdOssArcTrace.hh` | 调试跟踪宏定义，提供 `TRACE`/`DEBUG` 等日志宏 |
| `utils/` | 外部脚本目录，包含 Archiver、BkpUtils、Manifest、MssCom、Weka 等辅助程序 |

## 3. 详细结构分析

### 3.1 XrdOssArc — 模块入口（XrdOssArc.hh:39, XrdOssArc.cc:88）

继承自 `XrdOssWrapper`，是整个插件的顶层入口。

- **插件加载入口**：通过 `extern "C"` 导出的 `XrdOssAddStorageSystem2()` 函数（`XrdOssArc.cc:92`），被 XRootD OFS 层动态加载
- **工厂方法**：`newDir()` 和 `newFile()` 分别创建 `XrdOssArcDir` 和 `XrdOssArcFile` 包装对象
- **路径判断**：对于属于 `/archive/` 或 `/backup/` 的路径（`XrdOssArcCompose::isMine()`），拦截并处理操作；其他路径透传给底层 OSS
- **写保护**：`Chmod`、`Create`、`Mkdir`、`Remdir`、`Rename`、`Truncate`、`Unlink` 对归档路径均返回 `EROFS`（只读文件系统）
- **Stat 特殊处理**：`Stat` 方法可以查询归档文件或归档内成员的元数据

### 3.2 XrdOssArcConfig — 配置管理（XrdOssArcConfig.hh:37, XrdOssArcConfig.cc:99）

解析 XRootD 配置文件中 `ossarc.*` 前缀的配置指令，管理所有运行参数。

**配置指令**：
- `arcsize` — 归档文件的目标/最小/最大尺寸
- `backup` — 备份参数（scope、轮询间隔、并行数、最小可用空间等）
- `paths` — 各种路径设置（磁带缓冲区、暂存区、源数据、工具路径等）
- `rsedcl` — Rucio RSE 声明（源 RSE 和目标 RSE）
- `rucio` — Rucio 查询参数
- `stage` — 预取参数（最大并行数、轮询间隔）
- `trace` — 调试跟踪选项
- `utils` — 外部工具脚本路径（archiver、bkputils、msscom、preparc、postarc 等）
- `manifest` — 清单校验和算法
- `msscmd` — MSS 通信命令

**关键配置项**：
- `arcvPathLFN`：归档路径前缀，默认 `/archive/`
- `bkupPathLFN`：备份路径前缀，默认 `/backup/`
- `tapePath`：磁带缓冲区的本地挂载路径
- `arFName`：归档文件名，默认 `Archive.zip`
- `bkpMax`：最大并行备份数
- `maxStage`：最大并行预取数

### 3.3 XrdOssArcCompose — 路径合成器（XrdOssArcCompose.hh:39, XrdOssArcCompose.cc:73）

负责解析和分解归档/备份路径，提取数据集范围（Scope）、名称（Name）和文件信息。

**路径规则**：
- 归档路径格式：`/archive/<scope>:<dataset_name>`
- 备份路径格式：`/backup/<scope>:<dataset_name>`
- 文件访问通过 CGI 参数 `ossarc.fn` 指定

**核心方法**：
- `isMine()` — 判断路径是否属于本模块管理
- `ArcPath()` — 生成磁带缓冲区中的物理路径
- `ArcMember()` — 生成 ZIP 归档内的成员名称
- `DSN2Dir()` / `Dir2DSN()` — 数据集名称与目录名的双向转换（`/` ↔ `%`）
- `SetarName()` — 通过外部工具查询文件所在的归档文件名
- `Stat()` — 通过外部工具查询归档内文件的元数据

### 3.4 XrdOssArcFile — 文件操作（XrdOssArcFile.hh:39, XrdOssArcFile.cc:142)

继承自 `XrdOssWrapDF`，封装对归档内文件的读写操作。

**Open 逻辑**（`XrdOssArcFile.cc:142`）：
1. 通过 `XrdOssArcCompose` 判断路径类型
2. 如果不是归档路径，透传给底层 OSS
3. 如果是归档路径，先通过 `XrdOssArcStage::Stage()` 将归档文件拉取到本地
4. 如果请求的是整个归档文件（`isARC`），直接打开并提升给底层 OSS
5. 如果请求的是归档内的某个文件，创建 `XrdOssArcZipFile` 对象读取 ZIP 成员

**其他方法**：
- `Read()` — 从 ZIP 成员或底层 OSS 读取
- `Write()` — 对 ZIP 成员禁止写入（返回 `-EBADF`），对普通文件透传
- `Fstat()` — 获取 ZIP 成员的 stat 信息
- `Close()` — 关闭 ZIP 成员或底层文件

### 3.5 XrdOssArcDir — 目录操作（XrdOssArcDir.hh:39, XrdOssArcDir.cc:120)

继承自 `XrdOssWrapDF`，支持打开归档路径下的目录。

- `Opendir()` — 打开目录路径，将文件描述符提升给底层 OSS 处理
- 不支持 `/backup/` 路径的目录列表（返回 `EPERM`）

### 3.6 XrdOssArcStage — 预取调度（XrdOssArcStage.hh:40, XrdOssArcStage.cc:186)

继承自 `XrdJob`，实现从磁带/MSS 系统预取归档文件到本地磁盘。

**工作机制**：
1. `Stage()` 静态方法：检查文件是否在线（`isOnline()`），如果不在则调度预取任务
2. 使用 `Active` 集合跟踪正在预取的文件，避免重复操作
3. 使用 `Pending` 队列缓冲超出并行限制的请求
4. `DoIt()` 方法：实际执行预取（打开文件强制触发磁带系统拉取），处理队列中的后续任务
5. 返回 `EINPROGRESS` 表示预取正在进行中，调用者需稍后重试

### 3.7 XrdOssArcBackup — 备份管理（XrdOssArcBackup.hh:69, XrdOssArcBackup.cc:342)

继承自 `XrdJob`，实现数据集备份的调度和执行。

**组件**：
- `XrdOssArcBackup` — 备份调度器，按 scope 管理备份任务
- `XrdOssArcBackupTask` — 单个数据集的备份任务
- `BkpWorker` — 工作线程，从任务队列取出任务执行

**备份流程**：
1. `DoIt()` — 定期调用 `GetManifest()` 获取需要备份的数据集列表
2. `GetManifest()` — 通过 `BkpUtils` 脚本查询 Rucio 获取待备份数据集
3. `Add2Bkp()` — 将新数据集加入备份队列，通知空闲 Worker
4. `BkpWorker::DoIt()` — Worker 从队列取任务，调用 `BkpXeq()` 执行
5. `BkpXeq()` — 执行完整的备份流程：setup → 预取 → 预归档 → 归档 → 后归档 → 标记完成

**备份脚本调用链**：
- `BkpUtils setup` → 准备数据集文件
- `PrepArcProg`（可选）→ 预获取文件
- `ArchiverProg` → 创建 ZIP 归档并移动到磁带缓冲区
- `PostArcProg`（可选）→ 后处理
- `BkpUtils finish` → 标记备份完成

### 3.8 XrdOssArcFSMon — 文件系统监控（XrdOssArcFSMon.hh:41, XrdOssArcFSMon.cc:93)

继承自 `XrdJob`，周期性监控磁带缓冲区文件系统的空间使用情况。

**核心功能**：
- `Init()` — 初始化监控，设置最小可用空间阈值
- `DoIt()` — 定期更新文件系统统计信息（`statfs`）
- `Permit()` — 检查是否有足够空间执行备份任务，不足则阻塞
- `Release()` — 释放已预约的空间，唤醒等待的备份任务

**空间管理策略**：
- `fs_MinFree`：最小可用空间（可配置为百分比或绝对值）
- `fs_MaxUsed`：最大允许使用量 = 总容量 - 最小可用空间
- `fs_inBkp`：已预约但尚未完成备份的字节数
- 当 `fs_inUse + fs_inBkp + 任务大小 > fs_MaxUsed` 时，备份任务被阻塞

### 3.9 XrdOssArcStopMon — 停止监控（XrdOssArcStopMon.hh:42, XrdOssArcStopMon.cc:65)

继承自 `XrdJob`，实现优雅停止/恢复机制。

**工作原理**：
- 父实例定期检查 `admnPath` 目录下是否存在 `STOP` 文件
- 发现 `STOP` 文件后获取排他锁，等待所有正在执行的备份/恢复完成
- 获取排他锁后创建 `IDLE` 文件，进入休眠状态（每 10 秒检查一次）
- `STOP` 文件被删除后，删除 `IDLE` 文件，恢复执行
- 子实例（备份/恢复任务中创建）持有共享锁，阻止排他锁的获取

### 3.10 XrdOssArcZipFile — ZIP 文件操作（XrdOssArcZipFile.hh:45, XrdOssArcZipFile.cc:60)

封装 libzip 库，提供对 ZIP 归档文件的读取操作。

**核心方法**：
- `Open()` — 打开 ZIP 归档中的指定成员
- `Read()` — 读取成员文件数据，支持 seek
- `Stat()` — 获取成员文件的元数据（大小、索引等）
- `Close()` — 关闭成员文件

### 3.11 XrdOssArcTrace — 调试跟踪（XrdOssArcTrace.hh:35)

提供调试和跟踪的日志宏：
- `TRACE_Debug` — 调试信息
- `TRACE_Save` — 保存模式（备份后保留临时文件）
- `DEBUG(x)` — 仅在调试模式下输出

### 3.12 utils/ — 外部脚本

| 脚本 | 作用 |
|------|------|
| `XrdOssArc_BkpUtils` | 备份辅助工具：查询待备份数据集、设置元数据、定位文件所在归档、文件统计 |
| `XrdOssArc_Archiver` | 归档工具：将数据集文件打包为 ZIP 并移动到磁带缓冲区 |
| `XrdOssArc_MssCom` | MSS 通信工具：查询文件是否在线、与磁带系统交互 |
| `XrdOssArc_Manifest` | 清单管理工具 |
| `XrdOssArc_Weka` | Weka 存储后端支持工具 |

## 4. 模块依赖关系

### 4.1 该模块依赖的其他模块

| 依赖模块 | 用途 |
|---------|------|
| `XrdUtils` | 基础工具库 |
| `XrdServer` | 服务端框架 |
| `libzip` | ZIP 文件读写库 |
| `XrdOss` (`XrdOssWrapper`, `XrdOssDF`) | OSS 包装器和文件/目录对象基类 |
| `XrdOuc` (`XrdOucEnv`, `XrdOucProg`, `XrdOucStream`, `XrdOucGatherConf`) | 环境变量、程序执行、流处理、配置解析 |
| `XrdSys` (`XrdSysError`, `XrdSysFD`, `XrdSysPthread`, `XrdSysTrace`) | 错误处理、文件描述符、线程同步、跟踪 |
| `Xrd` (`XrdJob`, `XrdScheduler`) | 任务调度框架 |
| `XrdSec` (`XrdSecEntity`) | 安全实体（用于认证信息传递） |
| `XrdVersion` | 版本信息宏 |
| `XrdOssArc` 外部脚本 | `BkpUtils`、`Archiver`、`MssCom` 等辅助程序 |

### 4.2 依赖该模块的其他模块

- `XrdOss` — 在 `XrdOss.hh:69` 中声明了 `friend class XrdOssArcDF`，表明 XrdOss 核心模块与 XrdOssArc 有友元关系

该模块以**动态插件**形式加载（`BUILD_XRDOSSARC` CMake 选项控制），不直接被其他编译单元静态链接。

## 5. 架构总结

```
XRootD OFS Layer
    │
    ▼
XrdOssAddStorageSystem2()  ← 插件入口 (XrdOssArc.cc:92)
    │
    ▼
XrdOssArc (XrdOssWrapper)
    ├── newDir()  → XrdOssArcDir (XrdOssWrapDF)
    │                 └── XrdOssArcZipFile (libzip)
    ├── newFile() → XrdOssArcFile (XrdOssWrapDF)
    │                 └── XrdOssArcZipFile (libzip)
    ├── Stat()    → XrdOssArcCompose → 外部脚本
    └── InitArc() → XrdOssArcConfig
                      ├── XrdOssArcBackup (定时备份)
                      │     └── BkpWorker × N
                      ├── XrdOssArcStage (预取调度)
                      ├── XrdOssArcFSMon (空间监控)
                      └── XrdOssArcStopMon (停止监控)
```
