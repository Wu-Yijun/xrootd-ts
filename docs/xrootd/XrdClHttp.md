# XrdClHttp 模块分析

## 整体功能

`XrdClHttp` 是 XRootD 客户端库 (`XrdCl`) 的一个 **HTTP/WebDAV 插件模块**。它通过 libcurl 库实现了 XRootD 文件系统和文件操作接口的 HTTP/WebDAV 协议适配层，使得 XRootD 客户端能够透明地访问 HTTP/WebDAV 兼容的远程存储服务（如 S3、WebDAV 服务器等）。

该模块以动态库插件形式加载（通过 `XrdClGetPlugIn` 导出函数），核心使用 libcurl 的 multi 接口进行异步 HTTP 操作，支持：
- 文件的打开、读取（含预取/预下载优化）、写入（PUT 流式上传）、关闭
- 文件系统级操作：目录列表（PROPFIND）、创建目录（MKCOL）、删除（DELETE）、状态查询（HEAD/PROPFIND）、校验和查询
- 第三方拷贝（COPY/TPC）
- X509 证书认证支持
- 连接调用点（ConnectionCallout）和请求头调用点（HeaderCallout）扩展机制
- 性能监控与统计

## 文件列表

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | 构建配置：依赖 CURL、OpenSSL、Threads；编译为 XrdCl 插件动态库 |
| `XrdClHttpFactory.hh/cc` | 插件工厂：实现 `XrdCl::PlugInFactory` 接口，创建 File 和 Filesystem 实例 |
| `XrdClHttpFile.hh/cc` | 文件插件实现：实现 `XrdCl::FilePlugIn` 接口，支持 Open/Close/Read/Write/Stat 等 |
| `XrdClHttpFilesystem.hh/cc` | 文件系统插件实现：实现 `XrdCl::FileSystemPlugIn` 接口 |
| `XrdClHttpOps.hh/cc` | 核心操作类：定义所有 HTTP 操作的基类 `CurlOperation` 及各子类 |
| `XrdClHttpWorker.hh` | 工作线程：管理 libcurl 事件循环，处理操作队列中的 HTTP 请求 |
| `XrdClHttpUtil.hh/cc` | 工具类：HTTP 状态码转换、HeaderParser、HandlerQueue |
| `XrdClHttpOptionsCache.hh/cc` | HTTP 动词缓存：缓存服务器对 PROPFIND 等 HTTP 方法的支持情况 |
| `XrdClHttpParseTimeout.hh/cc` | 超时解析：Go 风格的持续时间字符串解析 |
| `XrdClHttpChecksum.hh` | 校验和类型定义：支持 CRC32C/MD5/SHA1/SHA256 |
| `XrdClHttpResponseInfo.hh` | 响应信息类：存储 HTTP 响应头的结构化数据 |
| `XrdClHttpResponses.hh` | 扩展响应类：在 XrdCl 标准响应上附加 ResponseInfo |
| `XrdClHttpConnectionCallout.hh` | 连接调用点接口：允许外部模块提供自定义 TCP socket |
| `XrdClHttpHeaderCallout.hh` | 请求头调用点接口：允许外部模块注入/修改自定义请求头 |

## 核心架构

```
XrdCl::PlugInFactory (XrdCl 框架)
    └── Factory (XrdClHttpFactory)
         ├── CreateFile() → File (XrdClHttpFile)
         └── CreateFileSystem() → Filesystem (XrdClHttpFilesystem)

File / Filesystem
    └── HandlerQueue (操作队列)
         └── CurlWorker (工作线程池, 默认 8 线程)
              └── CurlOperation (HTTP 操作基类)
                   ├── CurlStatOp / CurlOpenOp / CurlChecksumOp
                   ├── CurlReadOp / CurlPrefetchOpenOp
                   ├── CurlPutOp
                   ├── CurlDeleteOp / CurlMkcolOp / CurlListdirOp
                   └── CurlCopyOp / CurlQueryOp
```

## 依赖的模块

| 模块 | 说明 |
|------|------|
| `XrdCl` | XRootD 客户端库，提供插件接口定义 |
| `XrdUtils` | XRootD 通用工具 |
| `XrdXml` | XML 解析库（tinyxml），用于解析 WebDAV PROPFIND 响应 |
| `XrdOuc` | XRootD 工具库，提供 CRC 计算、JSON 处理 |
| `XrdSys` | 系统库，提供页面大小常量 |

## 外部依赖

| 库 | 用途 |
|----|------|
| libcurl | HTTP 客户端核心，所有 HTTP 操作通过 curl multi 接口异步执行 |
| OpenSSL | TLS 加密和 X509 证书处理 |
| Threads (pthreads) | 线程池和同步原语 |

## 被依赖关系

`XrdClHttp` 作为动态加载插件，不被其他模块直接编译链接。XrdCl 框架在运行时通过 `dlopen`/`LoadLibrary` 加载该插件。任何使用 XrdCl 且目标 URL 为 `http://`/`https://`/`davs://` 协议的应用程序在运行时会加载此插件。

## 关键设计特点

1. **异步多线程模型**：使用 libcurl multi 接口 + 线程池（默认 8 线程）
2. **预取（Prefetch）优化**：首次 Read 触发全文件 GET，后续顺序读从预取数据中获取
3. **流式 PUT 写入**：支持多次 Write 调用复用同一个 PUT 连接
4. **自适应超时**：支持 header 超时、传输停滞超时、慢速传输检测
5. **可扩展性**：通过 ConnectionCallout 和 HeaderCallout 接口支持自定义连接管理和请求头注入
