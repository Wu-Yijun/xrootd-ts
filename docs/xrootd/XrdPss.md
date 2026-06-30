# XrdPss 模块分析

## 模块概述

XrdPss 是 XRootD 的 **Proxy Storage System（代理存储系统）** 插件模块。它实现了 XrdOss（Object Storage System）接口，作为客户端与远程存储服务器之间的代理层。当 XRootD 服务器以代理模式运行时，XrdPss 负责将客户端的文件操作请求（如打开、读取、写入、删除等）转发到远程 origin 服务器执行，并将结果返回给客户端。

### 核心功能

- **文件操作代理**：将所有 POSIX 风格的文件操作（Open、Read、Write、Stat、Close 等）通过 XRootD 协议转发到远程服务器
- **目录操作代理**：支持 Opendir、Readdir、Closedir 等目录操作
- **路径转换（N2N）**：支持逻辑文件名到物理文件名的映射（lfn2pfn）
- **第三方拷贝（TPC）**：支持服务器间的直接数据传输，无需代理中转数据
- **身份映射（Persona）**：支持客户端身份到服务端身份的映射
- **缓存支持**：可与 XrdOfsPfc（PFC）缓存系统集成
- **校验和代理**：代理转发校验和查询请求到 origin 服务器
- **异步 I/O**：支持异步读写操作
- **出站代理**：支持作为转发代理（outgoing proxy）转发请求到其他 XRootD 集群

---

## 文件列表与功能说明

| 文件名 | 功能描述 |
|--------|----------|
| `CMakeLists.txt` | CMake 构建配置，定义编译目标和依赖链接 |
| `XrdPss.hh` | 主头文件，定义 XrdPssSys、XrdPssFile、XrdPssDir 三个核心类 |
| `XrdPss.cc` | 核心实现，包含系统初始化、文件/目录操作代理的完整实现 |
| `XrdPssConfig.cc` | 配置文件解析，处理 pss.* 命令行指令 |
| `XrdPssUrlInfo.hh` | URL 信息管理类头文件，处理 CGI 参数和身份标识 |
| `XrdPssUrlInfo.cc` | URL 信息管理类实现，包含 CGI 拼接和 ID 映射逻辑 |
| `XrdPssUtils.hh` | 工具类头文件，提供协议验证、域名提取等辅助功能 |
| `XrdPssUtils.cc` | 工具类实现，支持 http/https/root/xroot/pelican/s3 等协议 |
| `XrdPssTrace.hh` | 调试跟踪宏定义，控制 DEBUG 输出 |
| `XrdPssCks.hh` | 校验和代理类头文件，支持 adler32、crc32、md5、crc32c |
| `XrdPssCks.cc` | 校验和代理类实现，通过 XRootD 协议查询远程校验和 |
| `XrdPssAioCB.hh` | 异步 I/O 回调类头文件，管理异步操作的完成通知 |
| `XrdPssAioCB.cc` | 异步 I/O 回调类实现，包含对象池和结果处理 |
| `XrdPssAio.cc` | 异步 I/O 操作实现，包含 Read/Write/Fsync/pgRead/pgWrite 的异步版本 |

---

## 重要文件详细分析

### 1. XrdPss.hh - 核心类定义

定义了三个主要类：

#### XrdPssSys（继承自 XrdOss）
存储系统的主入口类，负责：
- 创建 XrdPssFile 和 XrdPssDir 实例
- 管理配置参数（origin 地址、导出路径、安全策略等）
- 提供静态方法进行路径转换（P2URL、P2OUT、P2DST）
- 处理文件系统级操作（Stat、Mkdir、Rename、Unlink 等）

关键静态成员：
- `XPList`：导出路径列表
- `Police[]`：访问控制策略（路径级和对象级）
- `fileOrgn`：本地文件系统 origin 路径
- `hdrData`：URL 头部模板
- `outProxy`：是否为出站代理
- `xLfn2Pfn`：是否启用 N2N 映射

#### XrdPssFile（继承自 XrdOssDF）
文件操作代理类，包含：
- 同步和异步的 Read/Write/ReadV/ReadRaw
- pgRead/pgWrite（带校验和的分页读写）
- Fstat/Fsync/Ftruncate
- TPC（第三方拷贝）支持

#### XrdPssDir（继承自 XrdOssDF）
目录操作代理类，包含：
- Opendir/Readdir/Closedir
- StatRet（返回 stat 信息）

### 2. XrdPss.cc - 核心实现

#### 入口函数
```cpp
extern "C" XrdOss *XrdOssGetStorageSystem2(...)
```
由 OFS 层调用，创建并返回 XrdPssSys 实例。

#### 路径转换核心
- `P2URL()`：将内部路径转换为远程 URL（支持 N2N 映射）
- `P2OUT()`：出站代理的 URL 生成
- `P2DST()`：提取目标主机并进行授权检查

#### 关键配置处理
`Init()` → `Configure()` → `ConfigProc()` → `ConfigXeq()` 的初始化链

### 3. XrdPssConfig.cc - 配置解析

支持的 pss.* 指令：

| 指令 | 功能 |
|------|------|
| `pss.origin` | 指定远程 origin 服务器地址 |
| `pss.export` | 定义导出路径和选项 |
| `pss.defaults` | 设置默认导出选项 |
| `pss.namelib` | 指定 N2N 映射库 |
| `pss.cache` | 配置缓存参数 |
| `pss.persona` | 配置身份映射（client/server） |
| `pss.permit` | 设置访问控制 |
| `pss.config` | 配置流和工作线程数 |
| `pss.dca` | 配置直接客户端访问 |
| `pss.reproxy` | 启用 TPC 重代理 |

### 4. XrdPssUrlInfo - URL 管理

负责：
- 从环境变量中提取用户 CGI 参数
- 生成 `pss.tid` 标识（用于 origin 识别请求来源）
- 管理流 ID（通过 XrdOucSid）
- 支持客户端身份映射

### 5. XrdPssCks - 校验和代理

通过 XRootD 协议向 origin 服务器查询文件校验和：
- 支持 adler32、crc32、md5、crc32c
- 使用 `cks.type` CGI 参数指定查询类型
- 支持校验和验证（Ver）

### 6. XrdPssAioCB - 异步回调管理

使用对象池模式管理异步回调对象：
- `Alloc()`：从池中分配回调对象
- `Complete()`：异步操作完成时的回调处理
- `Recycle()`：回收回调对象到池中
- 支持分页读写的校验和向量传递

---

## 依赖模块分析

### 直接依赖（CMakeLists.txt 链接）

| 模块 | 用途 |
|------|------|
| **XrdPosix** | POSIX 文件操作接口，通过 XrdPosixXrootd 执行远程 XRootD 操作 |
| **XrdUtils** | 通用工具库 |
| **XrdServer** | 服务器基础设施 |

### 头文件依赖

| 模块 | 用途 |
|------|------|
| **XrdOss** | OSS 接口定义（XrdOss、XrdOssDF 基类） |
| **XrdOuc** | 通用组件（Env、Export、PList、TList、Stream、Sid、Cache 等） |
| **XrdSys** | 系统工具（Error、Headers、Platform、Pthread、Trace） |
| **XrdSec** | 安全框架（SecEntity） |
| **XrdSecsss** | SSS 认证的 ID 映射 |
| **XrdNet** | 网络工具（Security、Addr、Utils） |
| **XrdCks** | 校验和框架 |
| **XrdSfs** | 存储文件系统接口（SfsAio） |
| **XrdPosix** | POSIX 扩展（Config、Extra、Info、Xrootd） |
| **XrdXrootd** | XRootD 协议（GStream） |
| **XrdOfs** | 对象文件系统（FSctl_PI） |

---

## 依赖该模块的模块

XrdPss 作为 OSS 插件，被以下模块加载使用：

- **XrdOfs**（Object File System）：通过 `XrdOssGetStorageSystem2` 函数动态加载 PSS 插件
- 任何配置了 `oss.module` 指向 PSS 库的 XRootD 服务器实例

---

## 架构概览

```
客户端请求
    ↓
XrdOfs（OFS 层）
    ↓ XrdOssGetStorageSystem2()
XrdPssSys（代理存储系统）
    ↓ 路径转换 + URL 生成
XrdPosixXrootd（POSIX/XRootD 客户端）
    ↓ XRootD 协议
远程 Origin 服务器
```

---

## 配置示例

```
# 设置 origin 服务器
pss.origin root://origin.example.com:1094

# 导出路径
pss.export /data readonly

# 启用出站代理模式
pss.origin = http://next-proxy.example.com

# 启用身份映射
pss.persona client strict verify

# 启用缓存（配合 PFC）
pss.cache /tmp/cache 5g
```

---

## 总结

XrdPss 是 XRootD 代理服务器的核心组件，实现了完整的存储系统代理功能。它将客户端的文件操作透明地转发到远程 origin 服务器，支持多种协议（root、http、https、s3 等）、身份映射、缓存集成和第三方拷贝等高级特性。模块设计清晰，职责分明，是构建 XRootD 代理集群的关键模块。
