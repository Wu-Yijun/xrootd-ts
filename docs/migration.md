# XRootD Client 迁移至 TypeScript/Rust — 完整设计文档

> 将 XrdCl（XRootD Client Library）迁移到 TypeScript 或 Rust 时需要关注的文件、核心模块、可选插件、可替代依赖、协议细节与架构设计。

---

## 目录

- [一、迁移范围总览](#一迁移范围总览)
- [二、原版架构分析](#二原版架构分析)
- [三、必须实现的核心模块](#三必须实现的核心模块)
- [四、网络通信层](#四网络通信层)
- [五、连接管理层](#五连接管理层)
- [六、用户 API 层](#六用户-api-层)
- [七、安全与认证模块](#七安全与认证模块)
- [八、可选插件](#八可选插件)
- [九、可替代的第三方依赖](#九可替代的第三方依赖)
- [十、核心协议详解](#十核心协议详解)
- [十一、架构设计建议](#十一架构设计建议)
- [十二、关键设计决策](#十二关键设计决策)
- [十三、工作量评估](#十三工作量评估)
- [十四、MVP 文件清单](#十四mvp-文件清单)
- [十五、关键注意事项](#十五关键注意事项)
- [十六、参考资源](#十六参考资源)

---

## 一、迁移范围总览

XrdCl 客户端库包含约 **138 个文件**，但迁移时不需要全部实现。按优先级分为三层：

```
┌─────────────────────────────────────────────────────────┐
│  必须实现（Core Protocol）                               │
│  ~15 个核心文件，约 3000-5000 行代码                      │
├─────────────────────────────────────────────────────────┤
│  建议实现（Essential Features）                           │
│  ~10 个文件，约 2000-3000 行代码                          │
├─────────────────────────────────────────────────────────┤
│  可选/可替代（Optional / Replaceable）                    │
│  其余文件，可用第三方库替代                                │
└─────────────────────────────────────────────────────────┘
```

**迁移策略**：自底向上实现，先解决协议和传输，再构建公共 API。

---

## 二、原版架构分析

### 2.1 分层架构

原版 C++ 客户端 (`XrdCl`) 采用经典的**分层 + Pimpl 模式**架构：

```
┌──────────────────────────────────────────────────┐
│  公共 API 层                                       │
│  File / FileSystem / CopyProcess                  │
│  + Operations 高阶封装 (Pipeline/Async)            │
│  + PlugIn 机制 (FilePlugIn, FileSystemPlugIn)     │
├──────────────────────────────────────────────────┤
│  状态管理层                                        │
│  FileStateHandler / MsgHandler / SIDManager        │
├──────────────────────────────────────────────────┤
│  传输调度层                                        │
│  PostMaster → Channel → Stream → AsyncSocket       │
├──────────────────────────────────────────────────┤
│  协议/安全层                                       │
│  XRootDTransport / XrdSec / TLS                    │
└──────────────────────────────────────────────────┘
```

### 2.2 四层调度模型

```
PostMaster (全局单例，路由入口)
    └── Channel (per-host 连接通道，持有 Stream + Transport + Poller)
         └── Stream (单连接管理，拥有多个 SubStream)
              └── AsyncSocketHandler (per-substream 的异步 I/O 处理器)
```

### 2.3 关键设计模式

| 模式 | 应用位置 | 说明 |
|------|----------|------|
| **Pimpl** | File, FileSystem, PostMaster | ABI 稳定性，编译隔离 |
| **Facade** | File, FileSystem, CopyProcess | 简化复杂子系统为统一接口 |
| **Strategy** | TransportHandler | 不同协议可替换传输策略 |
| **Factory** | TransportManager, PlugInFactory | 运行时动态创建 |
| **Observer** | MsgHandler, ChannelEventHandler | 异步事件通知 |
| **State Machine** | FileStateHandler | 管理有状态文件操作 |
| **Reactor** | Poller + AsyncSocketHandler | 非阻塞 I/O 事件驱动 |
| **Pipeline** | Operation + Pipeline | 操作链式组合执行 |

---

## 三、必须实现的核心模块

### 3.1 协议定义层 — `XProtocol/`

**优先级：P0（最高）**

| 文件 | 作用 | 迁移要点 |
|------|------|----------|
| `XPtypes.hh` | 基础类型定义（kXR_int32, kXR_int64 等） | TS: 使用 `number`/`BigInt`；Rust: 使用 `i32`/`i64` |
| `XProtocol.hh` | **核心协议定义**，包含所有请求/响应结构体 | 必须逐字段翻译，注意大端字节序 |
| `YProtocol.hh` | CMS 内部管理协议 | 客户端不需要实现 |

**关键数据结构（必须实现）：**

```typescript
// 1. 统一请求头（所有请求共享，固定 24 字节）
interface ClientRequestHdr {
  streamid: Uint8Array;   // 2 bytes — 流标识符（用于异步请求匹配）
  requestid: number;      // 2 bytes (大端) — 请求码 (3000-3032)
  body: Uint8Array;       // 16 bytes — 请求体（各请求类型不同）
  dlen: number;           // 4 bytes (大端) — 附加数据长度
}

// 2. 握手结构
// ClientInitHandShake: 20 字节
interface ClientInitHandShake {
  first: number;    // 4 bytes, = 0
  second: number;   // 4 bytes, = 0
  third: number;    // 4 bytes, = 0
  fourth: number;   // 4 bytes, = htonl(4)
  fifth: number;    // 4 bytes, = htonl(2012)
}

// ServerInitHandShake: 12 字节
interface ServerInitHandShake {
  msglen: number;    // 4 bytes — 服务器版本字符串长度
  protover: number;  // 4 bytes — 协议版本号 (network byte order)
  msgval: number;    // 4 bytes — 服务器类型: kXR_DataServer=1 或 kXR_LBalServer=0
}

// 3. 33 种请求类型（kXR_login=3007, kXR_open=3010, kXR_read=3013 等）
// 4. 响应码（kXR_ok=0, kXR_error=4003, kXR_redirect=4004 等）
// 5. 36 种错误码
```

**协议要点：**
- 所有二进制数据采用**网络字节序（大端）**传输
- 协议版本 `kXR_PROTOCOLVERSION = 0x00000520`（5.2.0）
- 请求头固定 **24 字节**：`streamid[2] + requestid[2] + body[16] + dlen[4]`
- 响应头固定 **8 字节**：`streamid[2] + status[2] + dlen[4]`

### 3.2 传输层 — `XrdCl/XrdClXRootDTransport.*`

**优先级：P0**

这是最复杂的部分，负责协议握手、消息编解码、认证流程。

**核心状态机：**
```
HandShakeMain (主流, subStreamId=0):
  Disconnected → HandShakeSent
    动作: 发送初始握手(20B) + kXR_protocol 合并为 44 字节
  HandShakeSent → HandShakeReceived
    动作: 接收 ServerResponseHeader(8B) + ServerInitHandShake(12B)
  HandShakeReceived → LoginSent
    动作: 处理 kXR_protocol 响应 → 发送 kXR_login
    注: 若需要 TLS，重新发送 kXR_protocol (带 kXR_wantTLS 标志)
  LoginSent → AuthSent 或 Connected
    动作: 接收 kXR_login 响应 (sessid[16] + 可选安全需求)
    若无需认证 → Connected
    若需认证 → AuthSent
  AuthSent → Connected
    动作: kXR_auth 多轮认证 → kXR_ok
  重连时: LoginSent → EndSessionSent → Connected
    动作: 先发 kXR_endsess 结束旧会话

HandShakeParallel (并行流, subStreamId>0):
  Disconnected → HandShakeSent → HandShakeReceived → BindSent → Connected
    动作: 初始握手 + kXR_protocol(expect=kXR_ExpBind) → kXR_bind
```

**必须实现的方法：**
- `HandShake()` — 握手状态机
- `GetHeader()` / `GetBody()` — 消息读取
- `MarshallRequest()` / `UnMarshallResponse()` — 消息编解码
- `Login()` / `DoAuthentication()` — 登录和认证
- `NeedEncryption()` — TLS 判断

### 3.3 消息层 — `XrdCl/XrdClMessage.*`

**优先级：P0**

消息封装类，管理请求/响应的序列化。

```typescript
class Message {
  buffer: Uint8Array;
  isMarshalled: boolean;
  sessionId: number;

  Marshall(body: Uint8Array): void;
  GetBody(): Uint8Array;
  GetSize(): number;
}
```

### 3.4 消息处理器 — `XrdCl/XrdClXRootDMsgHandler.*`

**优先级：P0**

处理服务器响应，解析响应码和数据。

**响应解析逻辑：**
```
kXR_ok        → 成功，返回数据
kXR_oksofar   → 部分成功（用于向量读写）
kXR_error     → 错误，解析 ServerResponseBody_Error (errnum + errmsg)
kXR_redirect  → 重定向，解析 ServerResponseBody_Redirect (port + host)
kXR_attn      → 异步事件，解析 ServerResponseBody_Attn (actnum + parms)
kXR_wait      → 等待，解析 ServerResponseBody_Wait (seconds + infomsg)
kXR_waitresp  → 等待后重试
kXR_authmore  → 认证需要更多数据
kXR_status    → 状态响应（CRC32C 校验）
```

---

## 四、网络通信层

### 4.1 Socket 封装 — `XrdCl/XrdClSocket.*`

**优先级：P0**

底层 TCP 连接管理。

| 语言 | 替代方案 |
|------|----------|
| TypeScript | `node:net` / `node:tls` |
| Rust | `tokio::net::TcpStream` |

### 4.2 TLS 加密 — `XrdCl/XrdClTls.*`

**优先级：P0**

TLS/SSL 加密通信。

| 语言 | 替代方案 |
|------|----------|
| TypeScript | `node:tls` 模块（内置 OpenSSL） |
| Rust | `rustls` 或 `openssl` crate |

### 4.3 I/O 多路复用 — `XrdCl/XrdClPoller*.*`

**优先级：P1**

异步 I/O 事件循环。

| 语言 | 替代方案 |
|------|----------|
| TypeScript | Node.js Event Loop（天然支持） |
| Rust | `tokio` 运行时 |

---

## 五、连接管理层

### 5.1 PostMaster — `XrdCl/XrdClPostMaster.*`

**优先级：P1**

消息分发中心，管理所有 Channel。全局单例，负责：
- 消息路由：根据 URL 选择正确的 Channel
- 连接管理：ForceDisconnect / ForceReconnect
- 重定向处理：Redirect / CollapseRedirect
- 基础设施：持有 Poller、TaskManager、JobManager

**简化方案：** TypeScript 可用 `Map<URL, Channel>` 替代。

### 5.2 Channel — `XrdCl/XrdClChannel.*`

**优先级：P1**

通信通道，封装与特定服务器的连接。管理 Stream + Transport + Poller。

**生命周期管理精妙**：PostMaster 持有 Channel 的 shared_ptr，Channel 持有自身的 weak_ptr，Stream 通过 weak_ptr 反向引用 Channel。

### 5.3 Stream — `XrdCl/XrdClStream.*`

**优先级：P1**

数据流管理，支持多子流（substream）复用。XRootD 协议支持在单个 TCP 连接上多路复用多个逻辑流（通常控制流 + 数据流）。

**简化方案：** 初版可简化为单子流实现。

**并行流（kXR_bind）：**
XRootD 支持在单个 TCP 连接上建立多个并行子流。主流程（subStreamId=0）通过 `kXR_login` 建立会话后，并行流通过以下步骤建立：

1. 发送初始握手 + `kXR_protocol`（`expect=kXR_ExpBind`）
2. 接收服务器握手和协议响应
3. 发送 `kXR_bind` 请求（携带主会话的 16 字节 sessid）
4. 服务器返回分配的 `substreamid`（1 字节）

并行流不需重新认证，共享主会话的安全上下文。

### 5.4 异步 Socket 处理 — `XrdCl/XrdClAsyncSocketHandler.*`

**优先级：P1**

异步 Socket 事件处理器，管理握手、读写、TLS。内部维护四个状态机组件：
- `AsyncHSWriter` — 握手消息写入器
- `AsyncMsgReader` — 响应消息读取器
- `AsyncHSReader` — 握手消息读取器
- `AsyncMsgWriter` — 请求消息写入器

通过 Poller 的事件回调驱动状态转换。

---

## 六、用户 API 层

### 6.1 File — `XrdCl/XrdClFile.hh`

**优先级：P1**

文件操作类，核心 API。每个操作都有异步（回调）和同步（阻塞）两个版本。

```typescript
class XrdClFile {
  // 核心操作（必须实现）
  open(path: string, flags: OpenFlags, mode?: OpenMode): Promise<Status>;
  close(): Promise<Status>;
  read(offset: number, size: number): Promise<[Status, Uint8Array]>;
  write(offset: number, data: Uint8Array): Promise<Status>;
  stat(infoType?: StatInfoEnum): Promise<[Status, StatInfo]>;
  sync(): Promise<Status>;
  truncate(size: number): Promise<Status>;

  // 向量 I/O（推荐实现）
  vectorRead(chunks: ChunkInfo[]): Promise<[Status, ChunkInfo[]]>;
  vectorWrite(chunks: ChunkInfo[]): Promise<Status>;

  // 页面校验读写（可选）
  pgRead(offset: number, size: number): Promise<[Status, Uint8Array, Uint32Array]>;
  pgWrite(offset: number, data: Uint8Array): Promise<Status>;

  // 扩展属性（可选）
  setXAttr(attrs: ExtendedAttributes): Promise<Status>;
  getXAttr(attrs: string[]): Promise<[Status, ExtendedAttributes]>;
  delXAttr(attrs: string[]): Promise<Status>;
  listXAttr(): Promise<[Status, string[]]>;

  // 高级操作（可选）
  fcntl(...): Promise<Status>;
  visa(...): Promise<[Status, VisaInfo]>;
}
```

### 6.2 FileSystem — `XrdCl/XrdClFileSystem.hh`

**优先级：P2**

文件系统元数据操作，无状态。

```typescript
class XrdClFileSystem {
  // 定位
  locate(path: string, flags: LocateFlags): Promise<[Status, LocationInfo]>;
  deepLocate(path: string, flags: LocateFlags): Promise<[Status, LocationList]>;

  // 元数据
  stat(path: string, infoType?: StatInfoEnum): Promise<[Status, StatInfo]>;
  statVFS(path: string): Promise<[Status, StatVFSInfo]>;
  protocol(): Promise<[Status, ProtocolInfo]>;

  // 目录操作
  dirList(path: string, flags?: DirListFlags): Promise<[Status, DirectoryList]>;
  mkDir(path: string, mode?: number): Promise<Status>;
  rmDir(path: string): Promise<Status>;

  // 文件管理
  mv(src: string, dst: string): Promise<Status>;
  rm(path: string): Promise<Status>;
  truncate(path: string, size: number): Promise<Status>;
  chmod(path: string, mode: number): Promise<Status>;

  // 查询
  query(queryCode: QueryCode, data?: Uint8Array): Promise<[Status, Uint8Array]>;
  ping(): Promise<Status>;
  sendInfo(info: string): Promise<Status>;
  sendCache(path: string): Promise<Status>;

  // 预取
  prepare(...): Promise<Status>;

  // 扩展属性
  setXAttr(path: string, attrs: ExtendedAttributes): Promise<Status>;
  getXAttr(path: string, attrs: string[]): Promise<[Status, ExtendedAttributes]>;
  delXAttr(path: string, attrs: string[]): Promise<Status>;
  listXAttr(path: string): Promise<[Status, string[]]>;
}
```

### 6.3 URL — `XrdCl/XrdClURL.*`

**优先级：P1**

URL 解析与操作。

```typescript
class URL {
  protocol: string;   // "root", "roots", "http", "davs", "file", etc.
  user?: string;
  password?: string;
  host: string;
  port: number;
  path: string;
  params: Map<string, string>;

  static parse(url: string): URL;
  toString(): string;
  isValid(): boolean;
  isLocalFile(): boolean;
  isSecure(): boolean;       // protocol == "roots"
  isMetalink(): boolean;     // path 以 ".metalink" 结尾
  isTPC(): boolean;          // 第三方拷贝
  getHostId(): string;       // user:password@host:port
  getChannelId(): string;    // 用于连接标识
  getLocation(): string;     // protocol://host:port/path
}
```

### 6.4 Status — `XrdCl/XrdClStatus.*`

**优先级：P0**

状态码和错误码定义。

```typescript
// 客户端状态码
enum StatusCode {
  OK = 0,                    // 操作成功
  Error = 1,                 // 操作失败
  StillInProgress = 2,       // 异步操作进行中
  NotImplemented = 3,        // 未实现
  TransactionFailed = 4,     // 事务失败
}

// 客户端错误码
enum ClientError {
  Ok = 0,
  InvalidArgs = 300,
  NotFound = 301,
  Permission = 302,
  Serialization = 303,
  CommandNotFound = 304,
  HostNotFound = 305,
  ServiceUnavail = 306,
  InternalError = 307,
  BadRequest = 308,
  Timeout = 309,
  InsufficientData = 310,
  Uninitialized = 311,
  Disconnected = 312,
  Redirect = 313,
  LossyRetry = 314,
  TooManyRedirs = 315,
  ChunkChecksumErr = 316,
  UnexpectedResp = 317,
  ClientSkipped = 318,
  Failed = 501,
  WinNetworkError = 601,
}

// 服务器错误码 (kXR_error 响应中的 errnum)
enum ServerError {
  ArgInvalid = 3000,
  ArgMissing = 3001,
  ArgTooLong = 3002,
  FileLocked = 3003,
  FileNotOpen = 3004,
  FSError = 3005,
  InvalidRequest = 3006,
  IOError = 3007,
  NoMemory = 3008,
  NoSpace = 3009,
  NotAuthorized = 3010,
  NotFound = 3011,
  ServerError = 3012,
  Unsupported = 3013,
  NoServer = 3014,
  NotFile = 3015,
  IsDirectory = 3016,
  Cancelled = 3017,
  ItExists = 3018,
  CheckSumErr = 3019,
  InProgress = 3020,
  OverQuota = 3021,
  SigVerErr = 3022,
  DecryptErr = 3023,
  Overloaded = 3024,
  FsReadOnly = 3025,
  BadPayload = 3026,
  AttrNotFound = 3027,
  TLSRequired = 3028,
  NoReplicas = 3029,
  AuthFailed = 3030,
  Impossible = 3031,
  Conflict = 3032,
  TooManyErrs = 3033,
  ReqTimedOut = 3034,
  TimerExpired = 3035,
}
```

### 6.5 响应类型 — `XrdCl/XrdClXRootDResponses.*`

**优先级：P1**

```typescript
interface StatInfo {
  id: number;
  size: number;
  flags: StatInfoFlags;
  modTime: number;

  isDir(): boolean;
  isLink(): boolean;
  isOffline(): boolean;
  isCached(): boolean;
  // ... 等
}

interface LocationInfo {
  locations: Location[];
  isServer(): boolean;
  isManager(): boolean;
  isRedirect(): boolean;
  isNone(): boolean;
}

interface DirectoryList {
  name: string;
  entries: DirectoryListInfo[];
}

interface ProtocolInfo {
  version: number;
  flags: number;
}
```

### 6.6 复制引擎 — `XrdCl/XrdClCopyProcess.*`

**优先级：P2**

高级拷贝引擎，支持并行分块、第三方拷贝、TPC 降级。

```
用户 → AddJob(PropertyList) → Prepare() → Run(CopyProgressHandler)
```

内部创建 CopyJob 对象，支持：
- `ClassicCopyJob` — 客户端中转（读源 → 写目标）
- `ThirdPartyCopyJob` — 服务器直传（kXR_prepare + HTTP TPC）
- `TPFallBackCopyJob` — TPC 降级到经典模式

---

## 七、安全与认证模块

### 7.1 安全协议框架 — `XrdSec/`

**优先级：P1**

安全框架核心，定义安全协议抽象接口。

**核心接口 `XrdSecProtocol`：**

| 方法 | 说明 |
|------|------|
| `Authenticate(creds, params, errInfo)` | 服务端验证客户端凭据。>0 需要更多握手, =0 成功, <0 失败 |
| `getCredentials(params, errInfo)` | 客户端生成凭据发送给服务端 |
| `Encrypt(in, inlen, out)` | 使用会话密钥加密数据（可选） |
| `Decrypt(in, inlen, out)` | 使用会话密钥解密数据（可选） |
| `Sign(in, inlen, out)` | 使用会话密钥签名数据（可选） |
| `Verify(in, inlen, sig, siglen)` | 验证签名（可选） |

**认证实体 `XrdSecEntity`：**

```typescript
interface SecEntity {
  prot: string;       // 认证协议名（"krb5", "gsi", "sss", "host", "unix"）
  name?: string;      // 实体名（用户名）
  host?: string;      // 主机名
  vorg?: string;      // 虚拟组织（VOMS）
  role?: string;      // 角色
  grps?: string;      // 组名
  caps?: string;      // 能力
  creds?: Uint8Array; // 原始凭据
  uid: number;        // Unix UID
  gid: number;        // Unix GID
}
```

### 7.2 认证插件优先级

| 模块 | 优先级 | 复杂度 | 说明 |
|------|--------|--------|------|
| **host** | P2 | 极低 | 基于主机信任，兜底协议，无加密 |
| **sss** | P2 | 中 | 共享密钥（Blowfish + CRC32），最实用的简单协议 |
| **unix** | P3 | 极低 | 传递 UID/GID，仅限同机 |
| **Kerberos 5** | P3 | 高 | 需要系统级 `libkrb5` |
| **GSI** | P3 | 极高 | X.509 证书链、代理证书、DH 密钥协商、CRL |
| **pwd** | P3 | 高 | 密码认证 + 密钥交换，3000+ 行 |
| **ztn** | P3 | 中 | 零信任 JWT 令牌 |
| **SciTokens** | P3 | 中 | 科学授权令牌 |
| **Macaroons** | P3 | 中 | 授权令牌 |
| **VOMS** | P3 | 高 | 虚拟组织成员服务 |

### 7.3 加密功能替代

| 接口类 | 功能 | TypeScript 替代 | Rust 替代 |
|--------|------|----------------|-----------|
| `XrdCryptoCipher` | 对称加密（AES, BF, 3DES） | `node:crypto` (createCipheriv) | `ring::aead` / `openssl::symm` |
| `XrdCryptoMsgDigest` | 消息摘要（SHA256, MD5） | `node:crypto` (createHash) | `ring::digest` / `openssl::hash` |
| `XrdCryptoRSA` | RSA 非对称加密/解密 | `node:crypto` (publicEncrypt) | `ring::rsa` / `openssl::rsa` |
| `XrdCryptoX509` | X.509 证书解析 | `@peculiar/x509` / `node-forge` | `x509-parser` / `openssl` |
| `XrdCryptoX509Chain` | 证书链验证 | `node:tls` / `node-forge` | `rustls` / `webpki` |
| `XrdCryptoLite` | 轻量加密（SSS Blowfish） | `node:crypto` (bf-ecb) | `openssl::symm::Cipher::bf_ecb()` |
| `KDFun()` | 密钥派生（PBKDF2） | `node:crypto` (pbkdf2) | `ring::pbkdf2` |

### 7.4 GSI 认证核心步骤（可选）

GSI 握手流程：

```
1. 客户端请求服务器证书
2. 服务器发送 X.509 证书链
3. 客户端验证证书链（CA 目录、CRL 检查）
4. 客户端发送自己的（代理）证书
5. DH 密钥协商，建立会话密钥
6. 可选：代理证书委托（proxy delegation）
```

**所需库功能**：
- X.509 证书解析（PEM/DER 格式）
- 证书链验证（CA trust anchor + CRL）
- RSA 加密/解密/签名/验证
- Diffie-Hellman 密钥交换
- 代理证书（RFC 3820）生成与验证

---

## 八、可选插件

### 8.1 可以跳过的模块

| 模块 | 原因 | 何时实现 |
|------|------|----------|
| **XrdEc**（纠删码） | 高级功能，大部分服务器不使用 | v2.0+ |
| **XrdClZip**（ZIP 支持） | 特殊场景，可用 Node.js/Rust ZIP 库替代 | v2.0+ |
| **XrdClCopyProcess**（复制过程） | 复杂的多阶段复制，可简化实现 | v1.5+ |
| **声明式操作框架** | 语法糖，可用 Promise 链替代 | 可选 |
| **Metalink 重定向** | 可用简单的 HTTP 请求替代 | v1.5+ |
| **监控插件** | 可选功能 | v2.0+ |
| **本地文件处理器** | 特殊场景 | 可选 |

### 8.2 可用第三方库替代的模块

| 原模块 | TypeScript 替代 | Rust 替代 |
|--------|----------------|-----------|
| **XrdSys**（系统抽象） | Node.js 内置 | `std` + `libc` |
| **XrdNet**（网络） | `node:net` / `node:dns` | `tokio::net` / `trust-dns` |
| **XrdTls**（TLS） | `node:tls` | `rustls` / `native-tls` |
| **XrdXml**（XML 解析） | `fast-xml-parser` / `xml2js` | `quick-xml` / `roxmltree` |
| **XrdOuc**（工具库） | Lodash / 自实现 | `std` + `thiserror` |
| **ZLIB**（压缩） | `node:zlib` | `flate2` |
| **OpenSSL**（加密） | `node:crypto` | `ring` / `openssl` |
| **UUID** | `uuid` 包 | `uuid` crate |

---

## 九、可替代的第三方依赖

### 9.1 TypeScript/Node.js 方案

| 原模块功能 | 推荐替代方案 | 说明 |
|-----------|-------------|------|
| **TCP 连接** | `node:net` / `node:tls` | 原生异步 I/O，完美匹配 |
| **TLS 加密** | `node:tls` | 内置 OpenSSL 绑定 |
| **非阻塞 I/O** | `node:net` Socket | 天然事件驱动 |
| **Blowfish 加密 (SSS)** | `node:crypto` (bf-ecb) | OpenSSL 绑定支持 |
| **CRC32/CRC32C** | `crc` / `sse4_crc32` / 自实现 | npm 生态丰富 |
| **SHA256/MD5** | `node:crypto` | 内置支持 |
| **RSA 操作** | `node:crypto` / `node-forge` | GSI 需要 |
| **X.509 证书解析** | `@peculiar/x509` / `node-forge` | GSI 需要 |
| **证书链验证** | `node:tls` / `node-forge` | GSI 需要 |
| **DH 密钥协商** | `node:crypto` (diffieHellman) | GSI 需要 |
| **JSON 处理** | 内置 `JSON` | — |
| **XML 解析 (Metalink)** | `fast-xml-parser` / `xml2js` | 可选 |
| **并发控制** | `Promise.all` / `p-limit` | — |
| **日志** | `pino` / `winston` | — |
| **测试** | `vitest` / `jest` | — |

**TypeScript 天然优势**：
- `async/await` 完美匹配 XRootD 的异步回调模型
- `Readable`/`Writable` Stream 可直接映射文件读写
- `EventEmitter` 匹配事件驱动架构
- 类型系统天然表达协议结构

### 9.2 Rust 方案

| 原模块功能 | 推荐替代方案 | 说明 |
|-----------|-------------|------|
| **TCP 连接** | `tokio::net::TcpStream` | 异步运行时 |
| **TLS 加密** | `rustls` / `openssl` | 推荐 rustls |
| **异步运行时** | `tokio` / `async-std` | — |
| **加密原语** | `ring` / `openssl` | ring 更安全，openssl 更全面 |
| **X.509 证书** | `x509-parser` / `rustls-pemfile` | — |
| **证书链验证** | `rustls` / `webpki` | — |
| **字节序转换** | `byteorder` / `bytes` | — |
| **错误处理** | `thiserror` / `anyhow` | — |
| **序列化/反序列化** | `bincode` / `serde` | 协议帧映射 |
| **并发** | `tokio::spawn` / `futures` | — |
| **FFI (ISA-L)** | `isal-sys` / `libc` | 纠删码可选 |
| **日志** | `tracing` / `log` | — |
| **测试** | 内置 `#[test]` | — |

**Rust 天然优势**：
- 零拷贝解析，适合二进制协议
- `#[repr(C)]` 结构体直接映射协议帧
- 无 GC，适合高性能存储场景
- `Pin` + `Future` 精确控制异步生命周期

---

## 十、核心协议详解

### 10.1 协议帧结构

```
请求帧 (24 字节固定头 + 变长数据):
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ streamid │ requestid│   body   │   dlen   │ data...  │
│  (2B)    │  (2B)    │  (16B)   │  (4B)    │ (dlen B) │
└──────────┴──────────┴──────────┴──────────┴──────────┘

响应帧 (8 字节固定头 + 变长数据):
┌──────────┬──────────┬──────────┬──────────┐
│ streamid │ status   │   dlen   │ data...  │
│  (2B)    │  (2B)    │  (4B)    │ (dlen B) │
└──────────┴──────────┴──────────┴──────────┘
```

**关键**：所有多字节字段使用 **网络字节序（大端序）**。

### 10.2 最小可行协议集

| 优先级 | 请求码 | 名称 | 用途 |
|--------|--------|------|------|
| **P0** | 3006 | `kXR_protocol` | 协议协商 |
| **P0** | 3007 | `kXR_login` | 登录/建立会话 |
| **P0** | 3010 | `kXR_open` | 打开文件 |
| **P0** | 3013 | `kXR_read` | 读取数据 |
| **P0** | 3019 | `kXR_write` | 写入数据 |
| **P0** | 3003 | `kXR_close` | 关闭文件 |
| P1 | 3017 | `kXR_stat` | 文件状态 |
| P1 | 3016 | `kXR_sync` | 同步到磁盘 |
| P1 | 3028 | `kXR_truncate` | 截断文件 |
| P1 | 3004 | `kXR_dirlist` | 列出目录 |
| P1 | 3008 | `kXR_mkdir` | 创建目录 |
| P1 | 3015 | `kXR_rmdir` | 删除目录 |
| P1 | 3014 | `kXR_rm` | 删除文件 |
| P1 | 3009 | `kXR_mv` | 移动/重命名 |
| P2 | 3025 | `kXR_readv` | 向量读 |
| P2 | 3031 | `kXR_writev` | 向量写 |
| P2 | 3027 | `kXR_locate` | 文件定位 |
| P2 | 3001 | `kXR_query` | 查询服务器信息 |
| P2 | 3011 | `kXR_ping` | 心跳 |
| P2 | 3023 | `kXR_endsess` | 结束会话 |
| P2 | 3000 | `kXR_auth` | 认证交换 |
| P2 | 3020 | `kXR_fattr` | 扩展属性 |
| P2 | 3021 | `kXR_prepare` | 预取/暂存 |
| P2 | 3002 | `kXR_chmod` | 修改权限 |
| P2 | 3022 | `kXR_statx` | 扩展状态 |
| P2 | 3024 | `kXR_bind` | 绑定子流 |
| P2 | 3030 | `kXR_pgread` | 页读取 |
| P2 | 3026 | `kXR_pgwrite` | 页写入 |
| P2 | 3032 | `kXR_clone` | 文件克隆 |
| P3 | 3005 | `kXR_gpfile` | 获取文件信息 |
| P3 | 3012 | `kXR_chkpoint` | 检查点操作 |
| P3 | 3018 | `kXR_set` | 设置属性 |
| P3 | 3029 | `kXR_sigver` | 签名验证 |

### 10.3 各请求详细结构

#### kXR_protocol (3006) — 协议协商

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3006
4       clientpv        4B      客户端协议版本 (0x520 = 5.2.0)
8       flags           1B      请求标志 (kXR_secreqs=0x01, kXR_ableTLS=0x02, kXR_wantTLS=0x04)
9       expect          1B      期望的后续操作
10      reserved[10]    10B     保留
20      dlen            4B      附加数据长度（通常为0）
```

**expect 字段取值：**
- `kXR_ExpLogin` = 0x01 — 告知服务器下一步将发送 login（主流）
- `kXR_ExpBind` = 0x02 — 告知服务器下一步将发送 bind（并行流）

**flags 字段取值（TLS 协商）：**
- `kXR_secreqs` = 0x01 — 请求服务器返回安全需求
- `kXR_ableTLS` = 0x02 — 声明客户端支持 TLS
- `kXR_wantTLS` = 0x04 — 请求切换到 TLS 加密连接
- `kXR_bifreqs` = 0x08 — 请求服务器返回 bind 接口偏好

若服务器要求 TLS，客户端需重新发送 kXR_protocol 请求（带 `kXR_wantTLS` 标志），然后通过 `node:tls` 升级连接。

#### kXR_login (3007) — 登录

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3007
4       pid             4B      进程ID
8       username[8]     8B      用户名（不足8字节填零）
16      ability2        1B      扩展能力 (kXR_ecredir=1)
17      ability         1B      能力标志位
18      capver[1]       1B      客户端版本 + 能力
19      reserved2       1B      保留
20      dlen            4B      附加数据长度（密码/令牌长度）
```

**能力标志位 (ability)**:
- `kXR_fullurl` = 1 — 支持完整 URL
- `kXR_multipr` = 3 — 多协议
- `kXR_readrdok` = 4 — 读重定向 OK
- `kXR_hasipv64` = 8 — 支持 IPv6
- `kXR_lclfile` = 64 — 本地文件
- `kXR_redirflags` = 128 — 重定向标志

**dlen 之后的 CGI 附加信息（可选）：**
客户端可在 dlen 之后附加一个查询字符串，格式为 `&key=value`，包含：
- ` country=` — 国家代码
- ` tz=` — 时区
- ` appname=` — 应用名称
- ` hostname=` — 客户端主机名
- ` version=` — 客户端版本号

#### kXR_open (3010) — 打开文件

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3010
4       mode            2B      权限位
6       options         2B      打开选项
8       optiont         2B      扩展选项 (kXR_dup=0x01, kXR_samefs=0x02...)
10      reserved[6]     6B      保留
16      fhtemplt[4]     4B      文件句柄模板
20      dlen            4B      路径名长度
```

**dlen 之后跟随**: 文件路径字符串（无 null 终止符）

**打开选项 (options)**:
- `kXR_open_read` = 0x0010 — 只读
- `kXR_open_updt` = 0x0020 — 更新
- `kXR_open_apnd` = 0x0200 — 追加
- `kXR_open_wrto` = 0x8000 — 写入目标
- `kXR_new` = 0x0008 — 新建
- `kXR_delete` = 0x0002 — 删除/截断
- `kXR_force` = 0x0004 — 强制
- `kXR_compress` = 0x0001 — 压缩
- `kXR_async` = 0x0040 — 异步
- `kXR_refresh` = 0x0080 — 刷新缓存
- `kXR_mkpath` = 0x0100 — 自动建路径
- `kXR_retstat` = 0x0400 — 返回 stat 信息
- `kXR_replica` = 0x0800 — 副本
- `kXR_posc` = 0x1000 — 持久在线存储
- `kXR_nowait` = 0x2000 — 不等待
- `kXR_seqio` = 0x4000 — 顺序 IO

#### kXR_read (3013) — 读取

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3013
4       fhandle[4]      4B      文件句柄（来自 open 响应）
8       offset          8B      文件偏移 (int64, network order)
16      rlen            4B      期望读取长度
20      dlen            4B      附加数据长度
```

#### kXR_write (3019) — 写入

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3019
4       fhandle[4]      4B      文件句柄
8       offset          8B      文件偏移 (int64)
16      pathid          1B      路径ID
17      reserved[3]     3B      保留
20      dlen            4B      写入数据长度
```

**dlen 之后跟随**: 要写入的原始数据

#### kXR_close (3003) — 关闭文件

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3003
4       fhandle[4]      4B      文件句柄
8       reserved[12]    12B     保留
20      dlen            4B      附加数据长度（通常为0）
```

#### kXR_stat (3017) — 获取状态

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3017
4       options         1B      kXR_vfs=1 (查询 VFS 信息)
5       reserved[7]     7B      保留
12      wants           4B      额外属性请求 (kXR_Want_btime=1)
16      fhandle[4]      4B      文件句柄
20      dlen            4B      路径名长度
```

#### kXR_readv (3025) — 向量读

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3025
4       reserved[15]    15B     保留
19      pathid          1B      路径ID
20      dlen            4B      read_list 数组总长度
```

**dlen 之后跟随**: `read_list[]` 数组，每个元素 16 字节:
```c
struct read_list {
   char    fhandle[4];   // 文件句柄
   int32   rlen;         // 读取长度
   int64   offset;       // 偏移
};
// 最多 1024 个元素
```

#### kXR_writev (3031) — 向量写

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3031
4       options         1B      doSync=0x01 时写后同步
5       reserved[15]    15B     保留
20      dlen            4B      write_list 数组总长度
```

**dlen 之后跟随**: `write_list[]` 数组 + 紧随每条记录的数据

#### kXR_dirlist (3004) — 列目录

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3004
4       reserved[15]    15B     保留
19      options[1]      1B      选项位 (kXR_online=1, kXR_dstat=2, kXR_dcksm=4)
20      dlen            4B      路径名长度
```

#### kXR_mv (3009) — 移动/重命名

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3009
4       reserved[14]    14B     保留
18      arg1len         2B      源路径长度
20      dlen            4B      总数据长度
```

**数据布局**: `[源路径][目标路径]`，`arg1len` = 源路径长度

#### kXR_auth (3000) — 认证

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3000
4       reserved[12]    12B     保留
16      credtype[4]     4B      凭证类型
20      dlen            4B      凭证数据长度
```

#### kXR_query (3001) — 查询

```
偏移    字段            大小    说明
──────────────────────────────────────────
0       streamid[2]     2B      流ID
2       requestid       2B      3001
4       infotype        2B      查询类型
6       reserved1       2B      保留
8       fhandle[4]      4B      文件句柄
12      reserved2[8]    8B      保留
20      dlen            4B      路径名长度
```

**infotype**: `kXR_QStats=1`, `kXR_QPrep=2`, `kXR_Qcksum=3`, `kXR_Qxattr=4`, `kXR_Qspace=5`, `kXR_Qconfig=7`, `kXR_Qvisa=8`, `kXR_QFinfo=9`, `kXR_QFSinfo=10`

### 10.4 服务器响应

#### 响应码

| 响应码 | 名称 | 含义 |
|--------|------|------|
| 0 | `kXR_ok` | 成功 |
| 4000 | `kXR_oksofar` | 部分成功（还在进行中） |
| 4001 | `kXR_attn` | 异步通知/消息 |
| 4002 | `kXR_authmore` | 认证需要更多数据 |
| 4003 | `kXR_error` | 错误 |
| 4004 | `kXR_redirect` | 重定向 |
| 4005 | `kXR_wait` | 等待（秒） |
| 4006 | `kXR_waitresp` | 等待后重试 |
| 4007 | `kXR_status` | 状态响应 |

#### kXR_error 响应体

```c
struct ServerResponseBody_Error {
   int32   errnum;       // 错误码 (见 ServerError 枚举)
   char    errmsg[4096]; // 错误消息文本
};
```

#### kXR_redirect 响应体

```c
struct ServerResponseBody_Redirect {
   int32   port;         // 重定向端口
   char    host[4096];   // 重定向主机名
};
```

#### kXR_wait 响应体

```c
struct ServerResponseBody_Wait {
   int32   seconds;      // 等待秒数
   char    infomsg[4096]; // 信息消息
};
```

#### kXR_attn 响应体

```c
struct ServerResponseBody_Attn {
   int32   actnum;       // 动作码 (kXR_asyncms=5002, kXR_asynresp=5008)
   char    parms[4096];  // 动作参数
};
```

#### 各请求的 kXR_ok 响应体

| 请求 | 响应体 | 说明 |
|------|--------|------|
| open | `fhandle[4] + cpsize(4B) + cptype[4] + 可选stat` | 文件句柄 |
| login | `sessid[16] + sec[4096]` | 会话 ID + 安全令牌 |
| protocol | `pval(4B) + flags(4B) + secreq` | 协议版本和能力 |
| read | 无固定体，`dlen` 字节数据 | 读取的数据 |
| write | `dlen=0` | — |
| stat/statx | 文本形式的 stat 信息 | — |
| dirlist | `dlen` 字节的目录条目文本 | — |
| bind | `substreamid(1B)` | 子流 ID |
| pgread | `offset(8B) + data[dlen]` | 页偏移 + 数据 |

#### kXR_status 响应（CRC32C 校验）

`kXR_status` (4007) 用于 pgread/pgwrite 的数据完整性校验，有额外的 `ServerResponseBody_Status` 结构：

```c
struct ServerResponseBody_Status {
   kXR_char  streamid[2];   // 流 ID（必须匹配请求）
   kXR_unt16 requestid;     // 请求 ID（必须匹配原始请求）
   kXR_int32 pgrwssz;       // 页读写单元大小 (kXR_pgUnitSZ = 4100)
   kXR_char reserved[4];    // 保留
};
```

客户端收到 `kXR_status` 后需要：
1. 验证 `streamid` 和 `requestid` 匹配原始请求
2. 对返回的每页数据计算 CRC32C，与页尾的 4 字节校验值比对
3. 如校验失败，收集失败页的偏移列表，通过重试请求告知服务器

### 10.5 握手时序（完整）

```
客户端                                      服务器
  |  1. TCP Connect                           |
  |─────────────────────────────────────────>|
  |                                           |
  |  2. ClientInitHandShake (20B)             |
  |     + kXR_protocol (24B)  [合并发送]       |
  |     first=0, second=0, third=0            |
  |     fourth=htonl(4), fifth=htonl(2012)    |
  |     clientpv=0x520, flags=secreqs|bifreqs |
  |     expect=kXR_ExpLogin                   |
  |─────────────────────────────────────────>|
  |                                           |
  |  3. ServerResponseHeader (8B)             |
  |     + ServerInitHandShake (12B)           |
  |     protover + msgval(1=DataServer)       |
  |<─────────────────────────────────────────|
  |                                           |
  |  4. kXR_ok + Protocol Response            |
  |     pval + flags + secReqs + bifReqs      |
  |<─────────────────────────────────────────|
  |                                           |
  |  5. kXR_login 请求                         |
  |     pid + username[8] + ability + CGI     |
  |─────────────────────────────────────────>|
  |                                           |
  |  6. kXR_ok + Login Response               |
  |     sessid[16] + secToken (可选)           |
  |     (若 body > 16B → 需要认证)              |
  |<─────────────────────────────────────────|
  |                                           |
  |  7. [可选] kXR_auth 多轮认证               |
  |     kXR_auth → kXR_authmore → ... → kXR_ok|
  |<────────────────────────────────────────>|
  |                                           |
  |  ===== 会话建立完毕 =====                   |
```

### 10.6 重定向处理

当服务器返回 `kXR_redirect` (4004) 时：
1. 解析 `ServerResponseBody_Redirect` 中的 host 和 port
2. 断开当前连接，连接到新地址
3. 重新执行握手 → 协议协商 → 登录
4. 重新发送原始请求
5. 限制最大重定向次数（通常 16 次）

### 10.7 重连与会话重建

当连接断开后重建时，客户端需要清理旧会话：
1. 发送 `kXR_endsess` 请求结束旧会话（让服务器关闭旧会话的可写句柄）
2. 重新执行握手 → 协议协商 → 登录
3. 如果旧会话的 `kXR_endsess` 返回 `kXR_NotFound`，视为正常（旧会话可能已过期）

重连流程：
```
断开 → TCP Connect → 发送 kXR_endsess(旧 sessid) → 等待响应
  → 初始握手 + kXR_protocol → kXR_login → [可选认证] → Connected
```

### 10.7 异步操作模式

打开文件时使用 `kXR_async` 选项可启用异步模式：
1. 客户端发送 `kXR_open` 带 `kXR_async` 选项
2. 服务器立即返回 `kXR_oksofar` (4000)
3. 服务器处理完成后通过 `kXR_attn` + `kXR_asynresp(5008)` 发送最终结果
4. 客户端通过 streamid 匹配异步响应

### 10.8 页读写

页读写使用 4KB 页大小 (`kXR_pgPageSZ = 4096`)，每页带 4 字节 CRC32C 校验：
- `kXR_pgUnitSZ = 4096 + 4 = 4100` 字节/页
- `kXR_pgMaxEpr = 128` — 每请求最多 128 个校验错误
- pgwrite 响应中若校验失败，返回需重传的页偏移列表

---

## 十一、架构设计建议

### 11.1 TypeScript 推荐架构（三层精简版）

```
xrootd-client/
├── src/
│   ├── index.ts                # 公共 API 导出
│   │
│   ├── protocol/               # 协议层：帧定义、编解码
│   │   ├── types.ts            # 基础类型（对应 XPtypes.hh）
│   │   ├── constants.ts        # 请求码、响应码、错误码枚举
│   │   ├── codec.ts            # 大端序编解码工具函数
│   │   └── message.ts          # 消息帧构建/解析（Message 类）
│   │
│   ├── transport/              # 三层传输架构
│   │   ├── transport.ts        # Layer 1: net.Socket 封装
│   │   ├── framer.ts           # Layer 2: 帧解析器（粘包/半包处理）
│   │   └── multiplexer.ts      # Layer 3: 简易多路复用器（streamid → Promise）
│   │
│   ├── session/                # 会话层：握手、认证
│   │   ├── handshake.ts        # 握手状态机（含 TLS 协商）
│   │   └── auth.ts             # 认证框架
│   │
│   ├── security/               # 安全协议插件
│   │   ├── interface.ts        # SecurityProtocol 接口
│   │   ├── host.ts             # host 认证（最简单）
│   │   └── sss.ts              # SSS 共享密钥认证
│   │
│   ├── url/
│   │   └── url.ts              # URL 解析
│   │
│   ├── api/                    # 公共 API 层
│   │   ├── file.ts             # File 类
│   │   ├── filesystem.ts       # FileSystem 类
│   │   ├── errors.ts           # XRootDError 类
│   │   └── types.ts            # StatInfo, LocationInfo 等
│   │
│   └── utils/
│       └── buffer.ts           # Buffer 工具函数
│
├── tests/
├── package.json
└── tsconfig.json
```

> 详细的 TypeScript API 设计（类接口、代码示例、实现细节）参见 [docs/typescript-design.md](typescript-design.md)。

### 11.2 Rust 推荐架构

```
xrootd-rs/
├── crates/
│   ├── xrootd-protocol/       # 协议帧定义、零拷贝编解码
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── types.rs       # 基础类型
│   │   │   ├── codec.rs       # 编解码（byteorder）
│   │   │   ├── request.rs     # 请求结构体
│   │   │   ├── response.rs    # 响应结构体
│   │   │   └── constants.rs   # 常量
│   │   └── Cargo.toml
│   │
│   ├── xrootd-transport/      # TCP/TLS 连接、异步读写
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── socket.rs      # TCP 连接
│   │   │   ├── tls.rs         # TLS 支持
│   │   │   ├── message.rs     # 消息封装
│   │   │   └── handler.rs     # 异步处理器
│   │   └── Cargo.toml
│   │
│   ├── xrootd-security/       # 安全协议框架 + SSS/host
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── interface.rs   # SecurityProtocol trait
│   │   │   ├── host.rs        # host 认证
│   │   │   └── sss.rs         # SSS 认证
│   │   └── Cargo.toml
│   │
│   ├── xrootd-client/         # 高层 API
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── file.rs        # File 结构体
│   │   │   ├── filesystem.rs  # FileSystem 结构体
│   │   │   ├── copy.rs        # CopyProcess
│   │   │   ├── url.rs         # URL 解析
│   │   │   ├── channel.rs     # Channel
│   │   │   ├── postmaster.rs  # PostMaster
│   │   │   └── error.rs       # 错误类型
│   │   └── Cargo.toml
│   │
│   └── xrootd-gsi/            # (可选) GSI/X.509 认证
│       ├── src/
│       │   └── lib.rs
│       └── Cargo.toml
│
├── Cargo.toml (workspace)
└── README.md
```

---

## 十二、关键设计决策

| 决策点 | 建议 |
|--------|------|
| **异步模型** | TS: async/await + EventEmitter; Rust: tokio + Future |
| **连接池** | 每个 (host:port) 维护一个 Channel，支持多路复用 |
| **流复用** | 初期可简化为单流，后续支持 streamid 多路复用 |
| **重定向** | 自动重连 + 重新握手 + 重发，限制最大重试次数（16次） |
| **错误恢复** | 文件句柄失效时自动重 open + seek 恢复 |
| **认证** | 初期仅 SSS + host，GSI 作为可选模块 |
| **插件** | TS: 动态 import; Rust: trait + Box<dyn> |
| **字节序** | 统一使用大端序工具函数 |
| **内存管理** | Rust: 零拷贝; TS: Buffer 池化 |
| **文件句柄管理** | 4 字节句柄 → Map<fhandle, FileHandle> 映射 |
| **请求匹配** | streamid 分配器，确保唯一性 |
| **超时处理** | 每个请求独立超时，支持取消 |

---

## 十三、工作量评估

| 阶段 | 内容 | 预估工时 |
|------|------|----------|
| **Phase 1** | 协议编解码 + TCP 连接 + 握手 + 基础文件操作 (open/read/write/close) | 2-3 周 |
| **Phase 2** | 完整文件/目录操作 + 错误处理 + 重定向 + SSS 认证 | 2-3 周 |
| **Phase 3** | 流复用 + 异步 I/O + TLS + 查询/统计 | 2-3 周 |
| **Phase 4** | 复制引擎 + 向量 I/O + 扩展属性 + 第三方拷贝 | 2-3 周 |
| **Phase 5** | GSI 认证 + 纠删码 + 插件系统 + 测试 | 3-4 周 |
| **总计** | — | **11-16 周** |

> 注：如仅实现 Phase 1-2，即可覆盖 80% 的日常使用场景。

### TypeScript vs Rust 对比

| 方面 | TypeScript | Rust |
|------|-----------|------|
| **开发速度** | 快，类型安全 | 较慢，所有权系统 |
| **性能** | 中等（V8 JIT） | 高（零成本抽象） |
| **异步模型** | async/await + Event Loop | tokio async/await |
| **TLS** | `node:tls`（内置） | `rustls` / `openssl` |
| **字节序处理** | `DataView` / `Buffer` | `byteorder` crate |
| **适用场景** | 快速原型、Node.js 生态 | 高性能、嵌入式 |
| **包大小** | 较大（Node.js 运行时） | 小（静态链接） |

---

## 十四、MVP 文件清单

**必须实现的文件（约 15 个）：**

```
# 协议定义
src/protocol/types.ts          # XPtypes.hh — 基础类型
src/protocol/protocol.ts       # XProtocol.hh — 请求/响应结构
src/protocol/constants.ts      # 请求码、响应码、错误码

# 传输层
src/transport/socket.ts        # XrdClSocket — TCP 连接
src/transport/tls.ts           # XrdClTls — TLS 支持
src/transport/message.ts       # XrdClMessage — 消息封装
src/transport/transport.ts     # XrdClXRootDTransport — 协议传输

# 连接管理
src/connection/channel.ts      # XrdClChannel — 连接通道
src/connection/postmaster.ts   # XrdClPostMaster — 消息路由

# 用户 API
src/api/file.ts                # XrdClFile — 文件操作
src/api/filesystem.ts          # XrdClFileSystem — 文件系统操作
src/api/url.ts                 # XrdClURL — URL 解析
src/api/status.ts              # XrdClStatus — 状态码和错误码
src/api/responses.ts           # XrdClXRootDResponses — 响应类型
```

---

## 十五、关键注意事项

1. **字节序**：XRootD 协议使用**大端（网络字节序）**。JavaScript 的 `DataView` 默认也是大端，Rust 需要 `byteorder` crate。

2. **Stream ID**：每个请求需要携带 2 字节的 stream ID，用于匹配请求和响应。客户端需要维护一个 stream ID 分配器（递增或随机）。

3. **Session ID**：Login 响应返回 16 字节的 session ID。注意：XRootD 协议的请求头（`ClientRequestHdr`）中并不直接携带 session ID，而是通过 `streamid[2]` 来隐式关联会话。session ID 主要用于：`kXR_auth` 认证请求、`kXR_endsess` 结束会话、`kXR_bind` 绑定并行流。客户端需要在内存中维护 `sessionId` 以供这些特殊请求使用。

4. **重定向**：服务器可能返回 `kXR_redirect`，客户端需要能够自动重连到新地址，重新握手+登录+重发请求。

5. **认证**：服务器在 Login 响应中返回安全令牌（secToken），客户端需要根据令牌选择合适的认证协议。

6. **文件句柄**：Open 响应返回 4 字节的文件句柄，后续 Read/Write/Close/Sync/Stat 都需要携带。

7. **异步模型**：XrdCl 使用回调式异步，TypeScript/Rust 可以用 Promise/async-await 简化。

8. **向后兼容**：协议修改必须保持向后兼容性（只能在末尾添加新码）。

9. **路径编码**：文件路径作为 dlen 之后的字节流发送，不含 null 终止符。

10. **大端序 dlen**：数据长度字段使用大端序，读取时需要 `ntohl()` 转换。

11. **空闲连接**：长时间无操作的连接可能被服务器关闭，客户端需要实现心跳保活（kXR_ping）。

12. **并发安全**：多线程/多协程环境下，文件句柄和连接需要适当的同步保护。

13. **TLS 升级**：TLS 在 kXR_protocol 交换期间通过 flags 字段协商。客户端声明 `kXR_ableTLS`，若服务器要求 TLS，客户端重新发送 kXR_protocol（带 `kXR_wantTLS`），然后通过 `node:tls`（TS）或 `rustls`（Rust）升级连接。升级后所有后续数据均加密。

---

## 十六、参考资源

- 原版客户端库: `src/XrdCl/` (核心), `src/XProtocol/` (协议)
- 协议定义: `src/XProtocol/XProtocol.hh` — 所有请求/响应结构
- 认证框架: `src/XrdSec/` — 安全协议接口
- 加密工具: `src/XrdCrypto/` — 密码学抽象层
- 测试参考: `tests/` 目录下的功能测试用例
- 模块分析: `docs/xrootd/index.md` — 各模块详细分析报告
