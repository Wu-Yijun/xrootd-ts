# XrdOssStats 模块分析

## 1. 模块概述

**XrdOssStats** 是 XRootD 服务端的一个 **OSS（Object Storage System）性能统计插件**，以动态库（MODULE）形式加载。它通过**装饰器（Wrapper）模式**对底层 OSS 进行包装，在不改变原有存储逻辑的前提下，透明地收集所有文件系统操作的性能指标（操作次数、耗时、慢操作统计），并通过 g-stream 监控通道以 JSON 格式输出，供 Prometheus 等外部监控系统消费。

## 2. 文件列表与作用

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | CMake 构建配置，定义模块编译目标、链接依赖及安装规则 |
| `export-lib-symbols` | 链接器符号可见性脚本，仅导出 `XrdOssAddStorageSystem2` 插件入口函数 |
| `README.md` | 模块使用文档，说明配置方法和统计数据字段含义 |
| `XrdOssStatsConfig.hh` | 配置工具声明：日志级别枚举、时间持续量解析函数 |
| `XrdOssStatsConfig.cc` | 配置工具实现 + **插件入口函数** `XrdOssAddStorageSystem2` 的定义 |
| `XrdOssStatsFileSystem.hh` | 核心类 `FileSystem` 声明：统计包装器的文件系统级别接口 |
| `XrdOssStatsFileSystem.cc` | `FileSystem` 实现：配置解析、操作计时、统计聚合与 g-stream 输出 |
| `XrdOssStatsFile.hh` | `File` 类声明：文件级别的 I/O 操作计时包装器 |
| `XrdOssStatsFile.cc` | `File` 类实现（仅析构函数） |
| `XrdOssStatsDirectory.hh` | `Directory` 类声明：目录级别操作的计时包装器 |

## 3. 详细结构分析

### 3.1 插件入口 (`XrdOssStatsConfig.cc`)

插件通过导出 C 函数 `XrdOssAddStorageSystem2` 注册到 XRootD 框架：

```
XrdOssAddStorageSystem2(curr_oss, logger, config_fn, parms, envP)
  → 创建 FileSystem(curr_oss, ...) 包装器
  → 调用 InitSuccessful() 检查初始化结果
  → 返回包装后的 OSS 或原始 OSS（非致命失败时）或 nullptr（致命失败）
```

该函数通过 `XrdVERSIONINFO` 宏声明插件版本信息，模块类型为 `fsstats`。

### 3.2 FileSystem 核心类 (`XrdOssStatsFileSystem.*`)

**设计模式**：继承自 `XrdOssWrapper`，实现装饰器模式。

**关键成员**：
- `m_oss`：被包装的底层 OSS 指针（`std::unique_ptr<XrdOss>`）
- `m_gstream`：g-stream 监控数据发送通道
- `m_ops` / `m_times`：操作计数器和耗时累加器（原子类型，线程安全）
- `m_slow_ops` / `m_slow_times`：慢操作的独立统计
- `m_slow_duration`：慢操作判定阈值（默认 1 秒）

**OpTimer 内部类**：利用 RAII 机制，在构造时记录起始时间，在析构时自动累加操作计数和耗时。若操作耗时超过 `m_slow_duration`，则同时累加慢操作统计。

**操作计时覆盖**：所有 OSS 操作（Chmod、Rename、Stat、Truncate、Unlink 等）均被包装，每次调用都通过 `OpTimer` 自动计时。

**统计聚合线程**：构造时启动一个后台线程（`AggregateBootstrap`），每秒运行一次 `AggregateStats()`，将累计的统计数据序列化为 JSON 并通过 `m_gstream->Insert()` 发送。

### 3.3 File 类 (`XrdOssStatsFile.*`)

继承自 `XrdOssWrapDF`，包装底层文件描述符对象。覆盖所有 I/O 方法：
- `Open`、`Read`、`Write`、`Fstat`、`Fchmod`、`Ftruncate`
- `pgRead`、`pgWrite`（带校验和的页对齐读写）
- `ReadV`、`WriteV`（向量读写）

每个方法体内创建 `OpTimer` 实例，在作用域结束时自动完成计时统计。

### 3.4 Directory 类 (`XrdOssStatsDirectory.hh`)

继承自 `XrdOssWrapDF`，包装目录操作：
- `Opendir`：计数目录列表操作
- `Readdir`：计数目录条目读取

### 3.5 配置工具 (`XrdOssStatsConfig.*`)

- `LogMask` 枚举：定义日志级别（Debug/Info/Warning/Error）
- `LogMaskToString`：将日志掩码转换为可读字符串
- `ParseDuration`：解析时间持续量字符串（如 `1s500ms`、`2.5s`、`100ms`），支持 ns/us/ms/s/m/h 单位

## 4. 构建配置

从 `CMakeLists.txt` 可知：
- 编译为**动态模块**（`MODULE`），运行时动态加载
- 链接依赖：`XrdServer`、`XrdUtils`
- 在非 Apple 平台使用版本脚本 `export-lib-symbols` 限制导出符号
- 安装到 `${CMAKE_INSTALL_LIBDIR}`

## 5. 依赖关系

### 5.1 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| **XrdOss** (`XrdOssWrapper.hh`) | OSS 包装器基类，提供 `XrdOssWrapper` 和 `XrdOssWrapDF` |
| **XrdSys** (`XrdSysError.hh`, `XrdSysRAtomic.hh`, `XrdSysPthread.hh`) | 日志系统、原子变量、线程管理 |
| **XrdOuc** (`XrdOucEnv.hh`, `XrdOucGatherConf.hh`) | 环境变量传递、配置文件解析 |
| **XrdXrootd** (`XrdXrootdGStream.hh`) | g-stream 监控数据发送通道 |
| **XrdServer** | XRootD 服务器核心（CMake 链接） |
| **XrdUtils** | XRootD 通用工具库（CMake 链接） |

### 5.2 依赖该模块的模块

该模块作为**独立插件**，不被其他模块直接编译依赖。它通过以下方式被引用：
- **运行时加载**：通过 `ofs.osslib ++ libXrdOssStats.so` 配置动态加载
- **父 CMakeLists.txt**：`src/CMakeLists.txt` 中的 `add_subdirectory(XrdOssStats)` 将其纳入构建
- **打包配置**：RPM (`xrootd.spec`) 和 Debian (`xrootd-server-plugins.install`) 打包脚本中包含该动态库
- **测试脚本**：`tests/XrdClHttp/setup.sh` 中用于集成测试

## 6. 统计数据输出格式

通过 g-stream 以 JSON 格式每秒输出一次，包含：
- 14 种操作的计数器（reads/writes/stats/opens/...）
- 14 种操作的总耗时（以秒为单位的浮点数）
- 14 种慢操作的独立计数器和耗时
- `event` 字段标识事件类型，支持区分不同运行模式（如 `oss_stats` vs `oss_stats_pfc`）

## 7. 设计要点

1. **零侵入**：通过装饰器模式完全透明地包装底层 OSS，对上层调用者无感知
2. **线程安全**：所有统计计数器使用 `RAtomic_uint64_t` 原子类型，支持多线程并发访问
3. **RAII 计时**：`OpTimer` 利用构造/析构自动完成计时，避免遗漏或重复计数
4. **优雅降级**：若 g-stream 不可用，插件会禁用自身但不阻止服务器启动（非致命失败）
5. **可配置**：慢操作阈值和日志级别均可通过配置文件调整
