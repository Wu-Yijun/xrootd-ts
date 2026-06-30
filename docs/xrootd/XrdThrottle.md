# XrdThrottle 模块分析

## 1. 模块概述

XrdThrottle 是 XRootD 的 I/O 限流插件，以可堆叠的文件系统（stackable filesystem）方式实现。其核心目标是：

1. **防止用户过载文件系统**：通过监控 I/O 请求，在用户超过设定的负载阈值时进行延迟或返回错误。
2. **用户间公平性**：采用 fairshare（公平共享）算法，允许短时间的突发使用，但保证长期的公平性。

该模块同时提供 **OFS 层**和 **OSS 层**两种加载方式，现代推荐使用 OSS 层（`ofs.osslib ++ libXrdThrottle.so`）。

---

## 2. 文件清单与功能

| 文件名 | 一句话描述 |
|--------|-----------|
| `CMakeLists.txt` | 构建配置：定义模块库、编译源文件、链接依赖、安装规则 |
| `README.md` | 插件的用户文档，描述配置方法和使用指南 |
| `XrdThrottle.hh` | 主头文件，定义 `File` 和 `FileSystem` 两个核心类（OFS 层接口） |
| `XrdThrottleTrace.hh` | 调试跟踪宏定义（TRACE_BANDWIDTH, TRACE_IOPS, TRACE_IOLOAD 等） |
| `XrdThrottleManager.hh` | 限流管理器核心类声明，包含公平共享算法、IO 计时器、负载分担等 |
| `XrdThrottleConfig.hh` | 配置类声明，封装所有配置参数的读取与存取接口 |
| `XrdThrottleManager.cc` | 限流管理器核心实现：份额计算、等待/唤醒逻辑、IO 计时、负载分担、用户限制 |
| `XrdThrottleConfig.cc` | 配置解析实现：解析配置文件中的 throttle、loadshed、trace、userconfig 等指令 |
| `XrdThrottleFile.cc` | OFS 层文件操作实现：拦截 read/write/pgRead/pgWrite 等操作并应用限流 |
| `XrdThrottleFileSystem.cc` | OFS 层文件系统操作实现：大部分为透传（pass-through）到底层 SFS |
| `XrdThrottleFileSystemConfig.cc` | OFS 层插件初始化入口：`XrdSfsGetFileSystem` 符号导出、FileSystem 单例初始化与配置 |
| `XrdOssThrottleFile.cc` | OSS 层限流实现：`XrdOssAddStorageSystem2` 入口，将限流包装在 OSS 层 |

---

## 3. 重要文件详细分析

### 3.1 XrdThrottleManager.hh / XrdThrottleManager.cc — 限流管理器核心

这是整个模块最核心的文件，约 1000 行实现代码。

#### 核心数据结构

- **`Waiter` 结构体**（按 cache line 对齐 `alignas(64)`）：
  - `m_cv` / `m_mutex`：每个用户的条件变量和互斥锁
  - `m_waiting`：等待中的 I/O 操作数
  - `m_concurrency`：EWMA（指数加权移动平均）计算的用户并发度
  - `m_io_time`：自上次重算以来该用户的 I/O 时间
  - `Wait()` 方法：线程在此等待直到被唤醒或超时

- **`TimerList` 结构体**：
  - 在 Linux 上按 CPU ID 哈希到 32 个链表，避免全局互斥锁竞争
  - 追踪正在进行中的 I/O 操作（`XrdThrottleTimer` 链表）

- **`XrdThrottleTimer` 类**：
  - RAII 风格的计时器，构造时启动、析构时停止
  - 嵌入双向链表节点（`m_prev`/`m_next`），支持快速插入和删除

- **唤醒顺序数组**：
  - `m_wake_order_0` / `m_wake_order_1`：双缓冲设计，每重算周期切换
  - 每个数组 1024 个元素（`m_max_users`），填充用户 ID，然后随机打乱
  - `m_wake_order_active`：原子标记当前活跃数组
  - `m_waiter_offset`：原子偏移量，用于顺序唤醒

#### 核心算法

1. **份额分配（RecomputeInternal）**：
   - 每 `interval_length_seconds`（默认 1 秒）重算一次
   - 将总带宽/操作数平均分配给所有活跃用户
   - 未使用的份额转为 secondary，可被其他用户"偷取"
   - primary 份额不可被偷，确保用户不会被完全饿死

2. **等待/唤醒调度（ComputeWaiterOrder）**：
   - 用 EWMA 计算每个用户的实际并发度
   - 按公平份额比例量化到 1024 元素数组
   - 随机打乱以避免固定顺序导致的不公平
   - 使用 `std::shuffle` + `std::default_random_engine`

3. **IO 计时与并发控制（StartIOTimer / StopIOTimer）**：
   - 原子递增 `m_io_active` 追踪并发 IO 数
   - 超过并发限制时，当前用户阻塞在 `Waiter::Wait()`
   - 停止时唤醒下一个等待者（优先唤醒低并发用户）

4. **文件/连接限制（OpenFile / CloseFile）**：
   - 跟踪每个用户的打开文件数和活跃连接数
   - 支持 per-user 限制（通过 INI 配置文件）
   - 匹配优先级：精确匹配 > 通配符（最长前缀） > `*` 全局默认 > 全局限制

5. **负载分担（Load Shedding）**：
   - 当限流被频繁触发时，随机将客户端重定向到其他服务器
   - 通过 `throttle.shed=1` opaque 参数防止循环重定向

### 3.2 XrdThrottle.hh — 核心类声明

#### `File` 类（继承 `XrdSfsFile`）
- 封装底层文件对象 `m_sfs`（`unique_sfs_ptr`）
- 拦截所有读写操作，应用限流
- 禁用 mmap 和 sendfile（无法监控）
- 异步 IO（AIO）转换为同步调用以保证计时准确

#### `FileSystem` 类（继承 `XrdSfsFileSystem`）
- 单例模式（`m_instance`）
- `Initialize()` 静态方法完成所有初始化
- `newFile()` 创建 `File` 对象并注入限流管理器
- 其他文件系统操作（mkdir, stat, rename 等）透传到底层 SFS

### 3.3 XrdThrottleConfig.hh / XrdThrottleConfig.cc — 配置系统

支持的配置指令：

| 指令 | 作用 | 默认值 |
|------|------|--------|
| `throttle.throttle` | 设置限流参数（data/iops/concurrency/interval） | 无限流 |
| `throttle.max_open_files` | 最大打开文件数 | -1（无限制） |
| `throttle.max_active_connections` | 最大活跃连接数 | -1（无限制） |
| `throttle.max_wait_time` | 最大等待时间（秒） | 30 |
| `throttle.loadshed` | 负载分担配置（host/port/frequency） | 禁用 |
| `throttle.trace` | 日志跟踪级别 | 0 |
| `throttle.userconfig` | per-user 限制配置文件路径 | 空 |
| `throttle.fslib` | 底层文件系统库 | libXrdOfs.so |

### 3.4 XrdOssThrottleFile.cc — OSS 层实现

提供两种加载方式的统一实现：
- **OFS 层**：`XrdSfsGetFileSystem` / `XrdSfsGetFileSystem2`（通过 `XrdThrottleFileSystemConfig.cc` 导出）
- **OSS 层**：`XrdOssAddStorageSystem2`（本文件导出）

OSS 层的优势：在 OFS 层已运行授权代码后加载，能获取用户名用于公平共享。

### 3.5 XrdThrottleTrace.hh — 调试跟踪

定义 6 个跟踪级别：
- `TRACE_BANDWIDTH`：带宽使用统计
- `TRACE_IOPS`：IOPS 统计
- `TRACE_IOLOAD`：并发负载统计
- `TRACE_DEBUG`：详细调试信息
- `TRACE_FILES`：文件打开/关闭跟踪
- `TRACE_CONNS`：连接跟踪

---

## 4. 依赖关系

### 4.1 XrdThrottle 依赖的模块

| 依赖模块 | 用途 |
|----------|------|
| **XrdServer** | XRootD 服务器核心框架 |
| **XrdUtils** | XRootD 通用工具库 |
| **XrdOfs** | Open Storage System 文件系统接口（编译时包含 `XrdOfsFS.cc`） |
| **XrdOuc** | 配置解析（`XrdOucStream`, `XrdOuca2x`, `XrdOucEnv`） |
| **XrdSys** | 系统工具（错误处理、线程、原子操作、定时器、插件加载） |
| **XrdSec** | 安全实体（`XrdSecEntity`，用于获取用户名） |
| **XrdSfs** | 文件系统接口基类（`XrdSfsFile`, `XrdSfsFileSystem`） |
| **XrdOss** | OSS 层接口（`XrdOss`, `XrdOssDF`, `XrdOssWrapper`） |
| **XrdXrootd** | `XrdXrootdGStream`（监控数据流接口） |
| **vendor/inih** | INI 文件解析库（用于 per-user 配置文件） |

### 4.2 依赖 XrdThrottle 的模块

**无外部模块依赖 XrdThrottle。** 该模块是一个独立的可加载插件（MODULE 库），通过 XRootD 的插件机制动态加载。用户在配置文件中指定 `ofs.osslib ++ libXrdThrottle.so` 或 `ofs.fslib libXrdThrottle.so` 来加载。

---

## 5. 构建信息

```
库类型：MODULE（动态插件库）
编译源文件：8 个 .cc 文件
链接库：XrdServer, XrdUtils
包含目录：vendor/inih（INI 解析库）
安装位置：${CMAKE_INSTALL_LIBDIR}
```

---

## 6. 总结

XrdThrottle 是一个设计精良的 XRootD I/O 限流插件，其核心特点包括：

1. **双层架构**：同时支持 OFS 和 OSS 层加载，OSS 层为推荐方式
2. **公平共享算法**：基于 EWMA 的并发度追踪 + 双缓冲唤醒顺序数组，实现无锁随机调度
3. **多维限流**：支持带宽、IOPS、并发度三种限流维度
4. **资源限制**：支持 per-user 和全局的文件/连接数限制
5. **负载分担**：支持将过载客户端重定向到其他服务器
6. **监控集成**：支持通过 `XrdXrootdGStream` 发送 JSON 格式的监控数据
