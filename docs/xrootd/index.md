# XRootD 源码模块分析索引

> 基于 `xrootd/src/` 目录下 51 个子模块的结构与功能分析。

---

## 一、核心基础层

| 模块 | 功能 | 文档 |
|------|------|------|
| **XProtocol** | 协议定义核心，定义客户端-服务器通信的二进制协议格式、请求码、响应结构、错误码 | [XProtocol.md](XProtocol.md) |
| **Xrd** | xrootd 服务器主程序入口，提供配置管理、网络连接、协议框架、任务调度 | [Xrd.md](Xrd.md) |
| **XrdSys** | 系统抽象层，跨平台封装线程同步、I/O 事件、日志、插件加载、原子操作等 | [XrdSys.md](XrdSys.md) |
| **XrdOuc** | 核心通用工具库（Open Utility Class），提供数据结构、配置解析、环境管理、缓存等 | [XrdOuc.md](XrdOuc.md) |
| **XrdNet** | 网络通信模块，TCP/UDP 连接管理、IPv4/IPv6 双栈、DNS 缓存、安全控制 | [XrdNet.md](XrdNet.md) |
| **XrdSut** | 安全工具库，为认证流程提供持久化存储、内存缓存、序列化缓冲区等基础设施 | [XrdSut.md](XrdSut.md) |
| **XrdTls** | TLS/SSL 安全通信模块，基于 OpenSSL 实现上下文管理、证书验证、会话缓存 | [XrdTls.md](XrdTls.md) |
| **XrdRmc** | 通用内存缓存（Real Memory Cache），基于 mmap 的分页式 LRU 缓存，支持预读 | [XrdRmc.md](XrdRmc.md) |

## 二、文件系统接口层

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdSfs** | 标准文件系统抽象接口（Standard File System），定义 `XrdSfsFileSystem`/`XrdSfsFile`/`XrdSfsDirectory` | [XrdSfs.md](XrdSfs.md) |
| **XrdOfs** | 核心文件系统层（Open File System），协调上层协议与底层存储，管理句柄、TPC、检查点 | [XrdOfs.md](XrdOfs.md) |
| **XrdOss** | 默认存储系统插件（Object Storage System），负责逻辑→物理文件名映射、读写、缓存管理 | [XrdOss.md](XrdOss.md) |
| **XrdXrootd** | XRootD 协议服务器端实现，处理所有协议请求（Open/Read/Write/Close 等） | [XrdXrootd.md](XrdXrootd.md) |

## 三、安全与认证模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdSec** | 安全框架核心，定义安全协议抽象接口、服务器端服务、请求签名保护 | [XrdSec.md](XrdSec.md) |
| **XrdSecgsi** | GSI 认证插件，基于 X.509 证书和代理证书的网格安全认证 | [XrdSecgsi.md](XrdSecgsi.md) |
| **XrdSeckrb5** | Kerberos 5 认证插件，支持票据转发 | [XrdSeckrb5.md](XrdSeckrb5.md) |
| **XrdSecpwd** | 密码认证插件，支持会话密钥协商和凭证管理 | [XrdSecpwd.md](XrdSecpwd.md) |
| **XrdSecsss** | SSS 共享密钥认证插件（Simple Shared Secret），轻量级对称认证 | [XrdSecsss.md](XrdSecsss.md) |
| **XrdSecunix** | Unix 身份认证插件，基于 euid/egid 传递用户信息 | [XrdSecunix.md](XrdSecunix.md) |
| **XrdSecztn** | 零信任网络认证插件，基于 JWT 令牌验证 | [XrdSecztn.md](XrdSecztn.md) |
| **XrdAcc** | 授权模块，基于路径+操作类型的多维度访问控制 | [XrdAcc.md](XrdAcc.md) |

## 四、客户端模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdCl** | 核心客户端库（Client Library），提供完整的 C++ API，支持异步/同步操作 | [XrdCl.md](XrdCl.md) |
| **XrdClHttp** | HTTP/WebDAV 客户端插件，通过 libcurl 适配 HTTP 协议 | [XrdClHttp.md](XrdClHttp.md) |
| **XrdClS3** | S3 对象存储客户端插件，支持 AWS V4 签名认证 | [XrdClS3.md](XrdClS3.md) |
| **XrdEc** | 纠删码客户端插件（Erasure Coding），条带化存储+奇偶校验容错 | [XrdEc.md](XrdEc.md) |
| **XrdPosix** | POSIX 接口透明映射层，支持 LD_PRELOAD 动态拦截 | [XrdPosix.md](XrdPosix.md) |

## 五、HTTP 协议模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdHttp** | HTTP/WebDAV 协议服务端插件，让标准 HTTP 客户端访问 XRootD | [XrdHttp.md](XrdHttp.md) |
| **XrdHttpTpc** | HTTP 第三方拷贝插件，支持 Push/Pull 模式和多流并行传输 | [XrdHttpTpc.md](XrdHttpTpc.md) |
| **XrdHttpCors** | HTTP CORS 跨域资源共享插件 | [XrdHttpCors.md](XrdHttpCors.md) |

## 六、集群与分布式模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdCms** | 集群管理核心（Cluster Management Software），节点协调、文件定位、负载均衡 | [XrdCms.md](XrdCms.md) |
| **XrdSsi** | 可扩展服务接口（Scalable Service Interface），支持请求-响应服务框架 | [XrdSsi.md](XrdSsi.md) |
| **XrdPss** | 代理存储系统（Proxy Storage System），将请求转发到远程 origin 服务器 | [XrdPss.md](XrdPss.md) |
| **XrdBwm** | 带宽管理器（Bandwidth Manager），拦截数据传输进行排队调度 | [XrdBwm.md](XrdBwm.md) |
| **XrdThrottle** | I/O 限流插件，提供带宽/IOPS/并发度控制和用户间公平性 | [XrdThrottle.md](XrdThrottle.md) |

## 七、文件管理与缓存模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdFrc** | 文件驻留管理客户端（File Residency Manager Client），管理预取/迁移/复制队列 | [XrdFrc.md](XrdFrc.md) |
| **XrdFrm** | 文件资源管理器（File Resource Manager），负责迁移、预取、缓存清理、传输 | [XrdFrm.md](XrdFrm.md) |
| **XrdFfs** | FUSE 文件系统接口，将 XRootD 集群挂载为本地 POSIX 文件系统 | [XrdFfs.md](XrdFfs.md) |
| **XrdPfc** | 代理文件缓存（Proxy File Cache），远程文件本地缓存，支持全文件预取和按需下载 | [XrdPfc.md](XrdPfc.md) |
| **XrdCks** | 校验和管理模块，支持多种算法（CRC32/MD5/Adler32）和插件扩展 | [XrdCks.md](XrdCks.md) |
| **XrdDig** | 只读文件系统插件，提供对服务器配置/日志/核心转储的安全访问 | [XrdDig.md](XrdDig.md) |

## 八、OSS 扩展插件

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdOssArc** | 归档存储插件，ZIP 打包+磁带预取+Rucio 备份调度 | [XrdOssArc.md](XrdOssArc.md) |
| **XrdOssCsi** | 校验和完整性插件，页面级 CRC32C 标签文件验证 | [XrdOssCsi.md](XrdOssCsi.md) |
| **XrdOssMirage** | 内存虚拟文件系统插件，用于测试，不存储实际数据 | [XrdOssMirage.md](XrdOssMirage.md) |
| **XrdOssStats** | 性能统计插件，装饰器模式收集操作计数和耗时，JSON 输出供 Prometheus | [XrdOssStats.md](XrdOssStats.md) |

## 九、密码学与工具模块

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdCrypto** | 密码学基础设施，对称/RSA 加密、X.509 证书链、GSI 策略，插件式工厂模式 | [XrdCrypto.md](XrdCrypto.md) |
| **XrdXml** | XML 解析模块，解析 Metalink 文件（RFC 5854） | [XrdXml.md](XrdXml.md) |
| **XrdZip** | 纯头文件 ZIP 格式库（header-only），支持 ZIP64 扩展 | [XrdZip.md](XrdZip.md) |
| **XrdApps** | 客户端应用工具集，包含 xrdmapc/xrdadler32/mpxstats 等 12 个命令行工具 | [XrdApps.md](XrdApps.md) |

## 十、授权令牌插件

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdMacaroons** | Macaroon 授权令牌插件，支持 caveats 限制和 OAuth 兼容端点 | [XrdMacaroons.md](XrdMacaroons.md) |
| **XrdVoms** | VOMS 授权信息提取插件，从 X.509 证书解析 FQAN 并映射为 Unix 用户 | [XrdVoms.md](XrdVoms.md) |
| **XrdSciTokens** | SciTokens 授权插件，基于 JWT 的科学授权令牌验证 | [XrdSciTokens.md](XrdSciTokens.md) |

## 十一、存储后端插件

| 模块 | 功能 | 文档 |
|------|------|------|
| **XrdCeph** | Ceph 分布式存储后端插件，由 CERN 开发，支持 librados 通信 | [XrdCeph.md](XrdCeph.md) |
