# XrdCeph 模块分析

## 1. 模块概述

XrdCeph 是 XRootD 框架的 **Ceph 对象存储后端插件**，由欧洲核子研究中心 (CERN) 开发。它实现了 XRootD 的 `XrdOss`（对象存储系统）接口和 `XrdSysXAttr`（扩展属性）接口，使 XRootD 能够将 Ceph 分布式存储系统作为文件系统后端使用。

该模块通过 `libradosstriper`（RADOS Striper）和 `librados` 库与 Ceph 集群通信，支持条带化存储（striping）、异步 I/O、缓冲读写和批量读取等高级特性。

## 2. 目录结构

```
XrdCeph/
├── CMakeLists.txt                          # 构建配置
├── XrdCephOss.cc / .hh                     # OSS 插件主类（入口点）
├── XrdCephOssFile.cc / .hh                 # 文件操作实现
├── XrdCephOssDir.cc / .hh                  # 目录操作实现
├── XrdCephOssBufferedFile.cc / .hh         # 缓冲文件装饰器
├── XrdCephOssReadVFile.cc / .hh            # ReadV 优化装饰器
├── XrdCephPosix.cc / .hh                   # POSIX 兼容层（核心库）
├── XrdCephXAttr.cc / .hh                   # 扩展属性插件
├── XrdCephBulkAioRead.cc / .hh             # 批量异步读取
└── XrdCephBuffers/                          # 缓冲子系统
    ├── ICephIOAdapter.hh                   # I/O 适配器接口
    ├── CephIOAdapterRaw.cc / .hh           # 同步 I/O 适配器
    ├── CephIOAdapterAIORaw.cc / .hh        # 异步 I/O 适配器
    ├── IXrdCephBufferAlg.hh                # 缓冲算法接口
    ├── XrdCephBufferAlgSimple.cc / .hh     # 简单缓冲算法实现
    ├── IXrdCephBufferData.hh               # 缓冲数据接口
    ├── XrdCephBufferDataSimple.cc / .hh    # 简单缓冲数据实现
    ├── IXrdCephReadVAdapter.hh             # ReadV 适配器接口
    ├── XrdCephReadVNoOp.cc / .hh           # ReadV 直通实现
    ├── XrdCephReadVBasic.cc / .hh          # ReadV 基本合并实现
    └── BufferUtils.cc / .hh                # 工具类（计时器、Extent）
```

## 3. 文件功能详述

### 3.1 核心层

| 文件 | 功能描述 |
|------|----------|
| `XrdCephPosix.hh/cc` | **核心 POSIX 封装层**：将 Ceph RADOS/Striper API 封装为类 POSIX 接口（open/close/read/write/stat 等），管理集群连接池、Striper 实例池、文件描述符表和异步 I/O 回调 |
| `XrdCephBulkAioRead.hh/cc` | **批量异步读取**：绕过 RADOS Striper，直接使用 librados 的 `ObjectReadOperation` 执行批量异步读取，提升非条带化文件的读取性能 |

### 3.2 OSS 插件层

| 文件 | 功能描述 |
|------|----------|
| `XrdCephOss.hh/cc` | **OSS 插件入口类**：实现 `XrdOss` 接口，通过 `XrdOssGetStorageSystem()` 导出函数作为插件加载入口；解析配置文件参数（连接数、缓冲、ReadV 等）；创建文件/目录对象实例 |
| `XrdCephOssFile.hh/cc` | **文件操作实现**：实现 `XrdOssDF` 接口，封装 Open/Close/Read/ReadV/Write/Fstat 等文件操作；支持 striper 和 non-striper 两种读取模式 |
| `XrdCephOssDir.hh/cc` | **目录操作实现**：实现 `XrdOssDF` 的目录接口（Opendir/Readdir/Close），通过 librados 的 `NObjectIterator` 枚举对象 |
| `XrdCephOssBufferedFile.hh/cc` | **缓冲文件装饰器**：装饰 `XrdCephOssFile`，添加客户端侧缓冲层，避免低效的小粒度读写；支持同步和异步两种 I/O 模式 |
| `XrdCephOssReadVFile.hh/cc` | **ReadV 优化装饰器**：装饰 `XrdCephOssFile`，通过合并分散的小读取请求为大块读取来优化 `ReadV` 操作 |

### 3.3 扩展属性层

| 文件 | 功能描述 |
|------|----------|
| `XrdCephXAttr.hh/cc` | **扩展属性插件**：实现 `XrdSysXAttr` 接口，通过 `XrdSysGetXAttrObject()` 导出函数作为插件加载；支持 Get/Set/Del/List 操作 |

### 3.4 缓冲子系统 (XrdCephBuffers/)

| 文件 | 功能描述 |
|------|----------|
| `ICephIOAdapter.hh` | I/O 适配器抽象接口，定义 `read()` 和 `write()` 纯虚方法 |
| `CephIOAdapterRaw.hh/cc` | 同步 I/O 适配器实现，通过 `ceph_posix_pread/pwrite` 直接读写 Ceph |
| `CephIOAdapterAIORaw.hh/cc` | 异步 I/O 适配器实现，通过 `ceph_aio_read/write` 异步读写 Ceph，内部阻塞等待完成 |
| `IXrdCephBufferAlg.hh` | 缓冲算法抽象接口，定义 read/write/read_aio/write_aio/flushWriteCache |
| `XrdCephBufferAlgSimple.hh/cc` | 简单缓冲算法实现：维护单缓冲区，读命中时直接返回缓存数据，未命中时从 Ceph 填充整个缓冲区 |
| `IXrdCephBufferData.hh` | 缓冲数据存储抽象接口，定义 capacity/length/readBuffer/writeBuffer 等 |
| `XrdCephBufferDataSimple.hh/cc` | 基于 `std::vector<char>` 的简单缓冲数据实现 |
| `IXrdCephReadVAdapter.hh` | ReadV 适配器抽象接口，定义将分散读取合并为大块读取的 `convert()` 方法 |
| `XrdCephReadVNoOp.hh/cc` | ReadV 直通实现，不做合并优化，仅做格式转换 |
| `XrdCephReadVBasic.hh/cc` | ReadV 基本合并实现，将小读取合并为 2MiB~16MiB 的大块读取 |
| `BufferUtils.hh/cc` | 工具类：`Timer_ns`（RAII 计时器）、`Extent`（偏移+长度）、`ExtentHolder`（Extent 容器） |

## 4. 构建产物

根据 `CMakeLists.txt`，该模块生成 **三个构建目标**：

| 目标 | 类型 | 说明 |
|------|------|------|
| `XrdCephPosix` | **SHARED 库** | POSIX 封装层共享库，包含 `XrdCephPosix` 和 `XrdCephBulkAioRead` |
| `XrdCeph-{VERSION}` | **MODULE 库** | OSS 插件模块，包含所有 OSS 文件和缓冲子系统，通过 `ofs.osslib` 加载 |
| `XrdCephXattr-{VERSION}` | **MODULE 库** | 扩展属性插件模块，通过 `ofs.xattrlib` 加载 |

## 5. 模块依赖

### 5.1 依赖的模块

| 依赖项 | 用途 |
|--------|------|
| **librados** | Ceph RADOS 核心库，提供集群连接和对象 I/O |
| **libradosstriper** | Ceph RADOS Striper 库，提供文件条带化存储 |
| **XrdUtils** | XRootD 工具库 |
| **XrdServer** | XRootD 服务器核心库 |
| **XrdOss** | XRootD OSS 接口头文件（`XrdOss.hh`） |
| **XrdOuc** | XRootD 对象容器（`XrdOucEnv`, `XrdOucTrace`, `XrdOucStream`, `XrdOucIOVec`） |
| **XrdSys** | XRootD 系统工具（`XrdSysError`, `XrdSysXAttr`, `XrdSysPthread`） |
| **XrdSfs** | XRootD SFS 接口（`XrdSfsAio`） |

### 5.2 被依赖的模块

XrdCeph 是一个**终端插件模块**，不被 XRootD 其他模块依赖。它通过以下方式被外部加载：
- XRootD 配置文件中的 `ofs.osslib` 指令加载 OSS 插件
- XRootD 配置文件中的 `ofs.xattrlib` 指令加载 XAttr 插件
- 测试代码（`tests/XrdCeph/`）引用了 `XrdCephPosix`

## 6. 核心设计模式

### 6.1 装饰器模式

文件创建流程（`XrdCephOss::newFile()`）采用装饰器堆叠：

```
XrdCephOssFile（基础文件操作）
    ↓ （可选）XrdCephOssReadVFile（ReadV 优化）
        ↓ （可选）XrdCephOssBufferedFile（缓冲层）
```

根据配置选项 `m_configReadVEnable` 和 `m_configBufferEnable` 决定是否添加装饰器。

### 6.2 策略模式

缓冲子系统使用策略模式分离关注点：
- `IXrdCephBufferAlg`：控制**何时/如何**缓冲
- `IXrdCephBufferData`：存储**缓冲数据本身**
- `ICephIOAdapter`：执行**底层 I/O 操作**

### 6.3 连接池

使用 `g_radosStripers` / `g_ioCtx` / `g_cluster` 向量实现连接池，通过 `g_cephPoolIdx` 轮询索引进行简单的负载均衡。

## 7. 配置参数

配置通过 `ofs.osslib` 指令和配置文件传入：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `ceph.nbconnections` | 连接池大小 | 1 |
| `ceph.namelib` | 名称映射库 | 无 |
| `ceph.usedefaultpreadalg` | 使用默认 striper pread 算法 | 0 |
| `ceph.usedefaultreadvalg` | 使用默认 striper readv 算法 | 0 |
| `ceph.aiowaitthresh` | AIO 超时警告阈值(秒) | 15 |
| `ceph.usebuffer` | 启用缓冲 | 0 (禁用) |
| `ceph.buffersize` | 缓冲区大小 | 16 MiB |
| `ceph.buffermaxpersimul` | 单实例最大缓冲区数 | 10 |
| `ceph.bufferiomode` | 缓冲 I/O 模式 | "aio" |
| `ceph.usereadv` | 启用 ReadV 优化 | 0 (禁用) |
| `ceph.readvalgname` | ReadV 算法名称 | "passthrough" |
| `ceph.reportingpools` | 用于空间报告的池名列表 | 空 |

## 8. 路径格式

文件路径支持以下格式来指定 Ceph pool 和用户：

```
[[userId@]pool[,nbStripes[,stripeUnit[,objectSize]]]:]<actual path>
```

例如：`admin:mypool,4,4194304,4194304:/path/to/file`

优先级：路径前缀 > 环境变量(cephUserId/cephPool) > 配置文件默认值 > 全局默认值(admin/default)
