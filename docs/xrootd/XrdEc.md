# XrdEc 模块分析

## 1. 模块概述

XrdEc（XRootD Erasure Coding）是 XRootD 生态系统中的**纠删码（Erasure Coding）客户端插件模块**，位于 `xrootd/src/XrdEc/` 目录下。该模块实现了数据的**条带化（striping）存储**和**纠删码冗余保护**，使文件数据可以被分割成多个条带（stripe）分布存储在多个存储节点上，并通过计算奇偶校验块（parity）来提供容错能力。

**核心功能：**
- 将文件数据按块（block）和条带（stripe）组织，分布到多个存储位置
- 使用 ISA-L（Intel Storage Acceleration Library）进行纠删码编码/解码
- 支持数据完整性校验（CRC32C）
- 支持数据恢复（当部分条带丢失或损坏时）
- 提供流式写入（StrmWriter）和随机读取（Reader）接口
- 数据以 ZIP 格式存储，包含元数据管理

**构建条件：** 需要通过 `-DENABLE_XRDEC=TRUE` 或 `-DBUILD_XRDEC=TRUE` 启用。

---

## 2. 文件结构与作用

| 文件名 | 类型 | 简要描述 |
|--------|------|----------|
| `CMakeLists.txt` | 构建配置 | 定义 XrdEc 共享库的编译目标、依赖链接和安装规则 |
| `README` | 文档 | 说明如何构建 XrdEc 以及 OFS 插件的重定向响应格式 |
| `XrdEcConfig.hh` | 头文件 | 全局配置单例类，管理冗余提供者（RedundancyProvider）缓存 |
| `XrdEcObjCfg.hh` | 头文件 | 数据对象配置结构体，包含纠删码参数（数据块数、校验块数、块大小等） |
| `XrdEcRedundancyProvider.hh` | 头文件 | 纠删码冗余提供者类声明，负责奇偶校验计算和数据恢复 |
| `XrdEcRedundancyProvider.cc` | 实现 | 纠删码核心算法实现，使用 ISA-L 进行编码/解码矩阵计算 |
| `XrdEcReader.hh` | 头文件 | 纠删码数据读取器类声明 |
| `XrdEcReader.cc` | 实现 | 读取器实现，包括打开、读取、向量读取、元数据解析和错误恢复 |
| `XrdEcStrmWriter.hh` | 头文件 | 流式写入器类声明 |
| `XrdEcStrmWriter.cc` | 实现 | 写入器实现，包括打开、写入、关闭和元数据保存 |
| `XrdEcThreadPool.hh` | 头文件 | 线程池单例类，封装 XrdCl::JobManager 提供异步任务调度 |
| `XrdEcUtilities.hh` | 头文件 | 工具函数和数据类型定义（stripe_t、sync_queue、IOError 等） |
| `XrdEcUtilities.cc` | 实现 | 回调调度函数实现（ScheduleHandler） |
| `XrdEcWrtBuff.hh` | 头文件 | 写缓冲区类（WrtBuff）和缓冲池（BufferPool），负责累积数据并计算校验和 |

---

## 3. 核心文件详细分析

### 3.1 XrdEcObjCfg.hh — 数据对象配置

`ObjCfg` 结构体是整个模块的配置核心，定义了纠删码数据对象的所有参数：

```cpp
struct ObjCfg {
    const std::string obj;           // 对象标识符
    const uint8_t     nbchunks;      // 每个块中的总条带数 (nbdata + nbparity)
    const uint8_t     nbparity;      // 校验条带数
    const uint8_t     nbdata;        // 数据条带数
    const uint64_t    datasize;      // 块中数据总大小 (nbdata * chunksize)
    const uint64_t    chunksize;     // 单个条带大小
    const uint64_t    paritysize;    // 校验总大小 (nbparity * chunksize)
    const uint64_t    blksize;       // 整个块大小 (datasize + paritysize)
    std::vector<std::string> plgr;   // placement group（存储位置列表）
    uint32_t (*digest)(...);         // 校验和函数指针（CRC32C 或 ISAL CRC32）
    bool nomtfile;                   // 是否不创建元数据文件
};
```

### 3.2 XrdEcRedundancyProvider.cc — 纠删码核心

使用 **Cauchy Reed-Solomon 编码**（通过 ISA-L 库）：

- **编码阶段**：使用 `gf_gen_cauchy1_matrix` 生成编码矩阵
- **解码阶段**：根据错误模式（缺失条带位置）生成解码矩阵，使用 `gf_gen_decode_matrix` 和 `ec_init_tables` 构建编码表
- **恢复逻辑**：通过 `compute()` 方法，先检测错误模式，再调用 ISA-L 的 `ec_encode_data` 进行数据恢复
- **复制模式**：当只有一个数据块时，使用简单复制而非纠删码

### 3.3 XrdEcReader.cc — 读取器

读取器实现了异步流水线操作：

1. **Open**：并行打开所有 ZIP 归档，读取元数据（中央目录），构建 URL 到条带的映射
2. **Read**：将用户请求映射到具体的块和条带，从 ZIP 归档中读取数据，验证 CRC32C 完整性
3. **VectorRead**：支持批量读取多个偏移和长度的数据段，优化网络传输
4. **错误恢复**：使用 `block_t` 结构体管理块状态（Empty/Loading/Valid/Missing/Recovering），在检测到数据丢失时触发纠删码恢复

关键数据结构：
- `dataarchs`：URL 到 ZipArchive 的映射
- `urlmap`：文件名到 URL 的映射
- `missing`：已知缺失的条带集合
- `block`：当前读取的块缓存

### 3.4 XrdEcStrmWriter.cc — 流式写入器

写入器采用**生产者-消费者模式**：

1. **Write**：数据先写入 `WrtBuff` 缓冲区，满后入队到线程池进行纠删码编码
2. **EnqueueBuff**：在独立线程中执行奇偶校验计算和 CRC32C 计算
3. **writer_routine**：专用写入线程，从队列中取出编码后的缓冲区，并行写入所有存储位置
4. **CloseImpl**：关闭 ZIP 归档，保存元数据（各归档的中央目录），设置扩展属性（文件大小、版本时间）

### 3.5 XrdEcThreadPool.hh — 线程池

单例线程池，封装 `XrdCl::JobManager`（64 个线程），提供泛型任务调度：
- `Execute(func, args...)`：提交任意可调用对象和参数，返回 `std::future`
- 使用模板元编程实现参数打包和解包

### 3.6 XrdEcWrtBuff.hh — 写缓冲区

- `BufferPool`：单例缓冲池，最大 1024 个缓冲区，支持回收复用
- `WrtBuff`：管理一个完整的数据块，提供 `Write()` 填充数据、`Encode()` 计算奇偶校验和 CRC32C

### 3.7 XrdEcUtilities.hh — 工具类

- `stripe_t`：单个条带的数据和有效性标记
- `IOError`：封装 XRootD 状态的异常类
- `sync_queue<Element>`：线程安全的同步队列，支持中断等待
- `ScheduleHandler()`：异步调度用户回调

---

## 4. 依赖关系

### 4.1 XrdEc 依赖的模块

从 `CMakeLists.txt` 的 `target_link_libraries` 和代码 `#include` 可以看出：

| 依赖模块 | 用途 |
|----------|------|
| **XrdCl** | XRootD 客户端库，提供文件操作、流水线、ZIP 归档操作、异步 I/O 等 |
| **XrdUtils** | XRootD 通用工具库 |
| **ISA-L** (Intel Storage Acceleration Library) | 硬件加速的纠删码编解码（`gf_gen_cauchy1_matrix`, `ec_encode_data`, `gf_invert_matrix` 等） |
| **XrdZip** | ZIP 文件格式处理（LFH、CDFH、EOCD 记录） |
| **XrdOuc** | CRC32C 校验和实现 |

### 4.2 依赖 XrdEc 的模块

| 依赖者 | 文件 | 用途 |
|--------|------|------|
| **XrdCl（客户端库）** | `XrdClEcHandler.hh/cc` | 客户端 EC 插件处理器，解析重定向响应中的 EC 参数，创建 `ObjCfg` 并使用 `Reader`/`StrmWriter` |
| **XrdCl（插件管理器）** | `XrdClPlugInManager.cc` | 注册 `XrdEcDefault` 插件库 |

XrdCl 的 `CMakeLists.txt` 将 XrdEc 的源文件（`.cc`）直接编译进 XrdCl 库中（`../XrdEc/XrdEcRedundancyProvider.cc` 等），而非作为独立共享库链接。

---

## 5. 数据流架构

```
写入流程:
  用户数据 → WrtBuff(累积) → ThreadPool(编码+CRC32C) → StrmWriter(并行写入ZIP归档) → 元数据保存

读取流程:
  用户请求 → Reader(解析offset→block/stripe) → ZipArchive读取 → CRC32C校验 → [失败则纠删码恢复] → 返回用户
```

---

## 6. 关键设计特点

1. **异步流水线**：所有 I/O 操作使用 XrdCl 的 Pipeline API 实现异步并发
2. **线程安全**：使用 mutex 和 sync_queue 保护共享状态
3. **错误容忍**：最多可容忍 `nbparity` 个条带丢失/损坏
4. **随机化放置**：每次写入时随机打乱服务器顺序，实现负载均衡
5. **元数据管理**：支持创建独立的元数据文件（`.mt`），或通过 xattr 存储文件大小
6. **ZIP 封装**：每个条带作为 ZIP 归档中的一个文件存储，中央目录用于索引
