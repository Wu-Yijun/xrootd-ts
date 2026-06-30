# Phase 1：协议编解码 + 基础传输

**目标**：在无认证场景下跑通 `login → open → read → close` 完整流程  
**工期**：2.5 周（~12 工作日）  
**当前状态**：Phase 0 基本完成（项目脚手架、Docker Mock Server、骨架代码）

---

## 总览

| 模块 | 内容 | 工时 | 依赖 |
|------|------|------|------|
| 模块一 | 协议基础层 | 2d | — |
| 模块二 | 请求帧构建 | 1d | 模块一 |
| 模块三 | 传输层 Layer 1 | 1d | 模块一 |
| 模块四 | 传输层 Layer 2 — Framer | 2d | 模块一、三 |
| 模块五 | 传输层 Layer 3 — Multiplexer | 2d | 模块一、四 |
| 模块六 | 会话层 — 握手状态机 | 2d | 模块一、五 |
| 模块七 | API 层 — File 类 | 1d | 模块二、五、六 |
| 模块八 | 端到端集成测试 | 1d | 所有模块 |

---

## 模块一：协议基础层（Day 1-2）

无依赖，可并行开发。

### 1.1 协议常量

**文件**：`src/protocol/constants.ts`

**产出**：

```typescript
// 请求码（3000-3032）
export const enum RequestId {
  Auth      = 3000,
  Query     = 3001,
  Chmod     = 3002,
  Close     = 3003,
  Dirlist   = 3004,
  Gpfile    = 3005,
  Protocol  = 3006,
  Login     = 3007,
  Mkdir     = 3008,
  Mv        = 3009,
  Open      = 3010,
  Ping      = 3011,
  Chkpoint  = 3012,
  Read      = 3013,
  Rm        = 3014,
  Rmdir     = 3015,
  Sync      = 3016,
  Stat      = 3017,
  Set       = 3018,
  Write     = 3019,
  Fattr     = 3020,
  Prepare   = 3021,
  Statx     = 3022,
  Endsess   = 3023,
  Bind      = 3024,
  ReadV     = 3025,
  PgWrite   = 3026,
  Locate    = 3027,
  Truncate  = 3028,
  Sigver    = 3029,
  PgRead    = 3030,
  WriteV    = 3031,
  Clone     = 3032,
}

// 响应码
export const enum ResponseStatus {
  Ok        = 0,
  Oksofar   = 4000,
  Attn      = 4001,
  Authmore  = 4002,
  Error     = 4003,
  Redirect  = 4004,
  Wait      = 4005,
  Waitresp  = 4006,
  Status    = 4007,
}

// 服务器错误码（kXR_error 响应中的 errnum）
export const enum ServerError {
  ArgInvalid    = 3000,
  ArgMissing    = 3001,
  ArgTooLong    = 3002,
  FileLocked    = 3003,
  FileNotOpen   = 3004,
  FSError       = 3005,
  InvalidRequest = 3006,
  IOError       = 3007,
  NoMemory      = 3008,
  NoSpace       = 3009,
  NotAuthorized = 3010,
  NotFound      = 3011,
  ServerError   = 3012,
  Unsupported   = 3013,
  NoServer      = 3014,
  NotFile       = 3015,
  IsDirectory   = 3016,
  Cancelled     = 3017,
  ItExists      = 3018,
  CheckSumErr   = 3019,
  InProgress    = 3020,
  OverQuota     = 3021,
  SigVerErr     = 3022,
  DecryptErr    = 3023,
  Overloaded    = 3024,
  FsReadOnly    = 3025,
  BadPayload    = 3026,
  AttrNotFound  = 3027,
  TLSRequired   = 3028,
  NoReplicas    = 3029,
  AuthFailed    = 3030,
  Impossible    = 3031,
  Conflict      = 3032,
  TooManyErrs   = 3033,
  ReqTimedOut   = 3034,
  TimerExpired  = 3035,
}

// 客户端错误码
export const enum ClientError {
  Ok              = 0,
  InvalidArgs     = 300,
  NotFound        = 301,
  Permission      = 302,
  Serialization   = 303,
  CommandNotFound = 304,
  HostNotFound    = 305,
  ServiceUnavail  = 306,
  InternalError   = 307,
  BadRequest      = 308,
  Timeout         = 309,
  InsufficientData = 310,
  Uninitialized   = 311,
  Disconnected    = 312,
  Redirect        = 313,
  LossyRetry      = 314,
  TooManyRedirs   = 315,
  ChunkChecksumErr = 316,
  UnexpectedResp  = 317,
  ClientSkipped   = 318,
  Failed          = 501,
}

// 协议常量
export const PROTOCOL_VERSION = 0x00000520  // 5.2.0
export const REQUEST_HDR_SIZE = 24
export const RESPONSE_HDR_SIZE = 8
export const BODY_SIZE = 16
export const SESS_ID_SIZE = 16
export const FHANDLE_SIZE = 4

// 握手固定值
export const HANDSHAKE_FIRST = 0
export const HANDSHAKE_SECOND = 0
export const HANDSHAKE_THIRD = 0
export const HANDSHAKE_FOURTH = 4      // htonl(4)
export const HANDSHAKE_FIFTH = 2012    // htonl(2012)

// kXR_protocol flags
export const kXR_secreqs = 0x01
export const kXR_ableTLS = 0x02
export const kXR_wantTLS = 0x04
export const kXR_bifreqs = 0x08

// kXR_protocol expect
export const kXR_ExpLogin = 0x01
export const kXR_ExpBind = 0x02

// 打开选项
export const enum OpenFlags {
  Read    = 0x0010,
  Write   = 0x0020,
  Append  = 0x0200,
  New     = 0x0008,
  Delete  = 0x0002,
  Force   = 0x0004,
  Compress = 0x0001,
  Async   = 0x0040,
  Refresh = 0x0080,
  Mkpath  = 0x0100,
  Retstat = 0x0400,
  Replica = 0x0800,
  Posc    = 0x1000,
  Nowait  = 0x2000,
  Seqio   = 0x4000,
}
```

**工时**：3h

---

### 1.2 大端序编解码工具

**文件**：`src/protocol/codec.ts`

**产出**：

```typescript
// 写入大端序整数
export function put16(buf: Buffer, offset: number, value: number): number
export function put32(buf: Buffer, offset: number, value: number): number

// 读取大端序整数
export function get16(buf: Buffer, offset: number): [number, number]  // [value, newOffset]
export function get32(buf: Buffer, offset: number): [number, number]

// 字符串编解码（不含 null 终止符）
export function putString(buf: Buffer, offset: number, str: string, maxLen: number): number
export function getString(buf: Buffer, offset: number, length: number): [string, number]

// 字节拷贝
export function putBytes(buf: Buffer, offset: number, data: Uint8Array): number
export function getBytes(buf: Buffer, offset: number, length: number): [Buffer, number]
```

**工时**：3h

---

### 1.3 URL 解析

**文件**：`src/url/url.ts`

**产出**：

```typescript
export class XRootDUrl {
  protocol: string   // "root", "roots"
  user?: string
  password?: string
  host: string
  port: number
  path: string

  constructor(url: string)

  static parse(url: string): XRootDUrl
  toString(): string
  isValid(): boolean
  isSecure(): boolean       // protocol == "roots"
  getHostId(): string       // user:password@host:port
  getChannelId(): string    // 用于连接标识
  getLocation(): string     // protocol://host:port/path
}
```

**关键**：路径以 `/` 开头，支持 `root://host:port/path` 和 `root://host/path`（默认端口 1094）

**工时**：2h

---

### 1.4 错误类型

**文件**：`src/api/errors.ts`

**产出**：

```typescript
export class XRootDError extends Error {
  /** kXR 协议错误码 (3000-3035) */
  readonly code: number
  /** POSIX errno（如果服务器返回了映射） */
  readonly errno?: number

  constructor(code: number, message?: string, errno?: number)

  /** 根据错误码生成可读消息 */
  static codeToMessage(code: number): string
}
```

**工时**：2h

---

### 1.5 类型定义

**文件**：`src/api/types.ts`

**产出**：

```typescript
export interface OpenOptions {
  flags?: OpenFlags
  mode?: number
  signal?: AbortSignal
}

export interface StatInfo {
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

export interface ChunkInfo {
  fhandle: Uint8Array  // 4 bytes
  offset: number
  length: number
  data?: Uint8Array    // 读取时返回
}

export interface LocationInfo {
  locations: Location[]
  get isServer(): boolean
  get isManager(): boolean
  get isRedirect(): boolean
}

export interface DirectoryList {
  name: string
  entries: DirectoryListInfo[]
}

export interface ProtocolInfo {
  version: number
  flags: number
}
```

**工时**：2h

---

### 验收

- `src/protocol/codec.test.ts` 通过：验证所有编解码函数的字节序正确性
- `npm run typecheck` 通过

---

## 模块二：请求帧构建（Day 3）

依赖模块一。

### 2.1 协议请求帧构建函数

**文件**：`src/protocol/message.ts` 扩展

**产出**：

```typescript
// 初始握手 + kXR_protocol 合并 44 字节
export function buildHandshakeAndProtocol(
  streamId: number,
  flags?: number,
  expect?: number
): Buffer

// kXR_login 请求
export function buildLoginRequest(
  streamId: number,
  pid: number,
  username: string,
  ability?: number,
  cgi?: string
): Buffer

// kXR_open 请求
export function buildOpenRequest(
  streamId: number,
  path: string,
  options: number,
  mode?: number
): Buffer

// kXR_read 请求
export function buildReadRequest(
  streamId: number,
  fhandle: Uint8Array,
  offset: number,
  rlen: number
): Buffer

// kXR_write 请求
export function buildWriteRequest(
  streamId: number,
  fhandle: Uint8Array,
  offset: number,
  data: Uint8Array
): Buffer

// kXR_close 请求
export function buildCloseRequest(
  streamId: number,
  fhandle: Uint8Array
): Buffer

// kXR_stat 请求
export function buildStatRequest(
  streamId: number,
  path: string,
  fhandle?: Uint8Array
): Buffer
```

### 2.2 响应帧解析函数

**文件**：`src/protocol/message.ts` 扩展

**产出**：

```typescript
export interface ProtocolResponse {
  pval: number
  flags: number
  secReqs?: string
  bifReqs?: string
}

export interface LoginResponse {
  sessid: Uint8Array  // 16 bytes
  secToken?: Uint8Array
  needsAuth: boolean
}

export interface OpenResponse {
  fhandle: Uint8Array  // 4 bytes
}

export interface ErrorResponse {
  errnum: number
  errmsg: string
}

export interface RedirectResponse {
  port: number
  host: string
}

export interface WaitResponse {
  seconds: number
  infomsg: string
}

export function parseProtocolResponse(body: Buffer): ProtocolResponse
export function parseLoginResponse(body: Buffer): LoginResponse
export function parseOpenResponse(body: Buffer): OpenResponse
export function parseErrorResponse(body: Buffer): ErrorResponse
export function parseRedirectResponse(body: Buffer): RedirectResponse
export function parseWaitResponse(body: Buffer): WaitResponse
```

**关键协议细节**：
- `kXR_login` 响应体：`sessid[16] + secToken`，若 body > 16B 则 `needsAuth = true`
- `kXR_open` 响应体：`fhandle[4] + cpsize(4B) + cptype[4] + 可选stat`
- `kXR_error` 响应体：`errnum(4B) + errmsg(variable)`
- `kXR_redirect` 响应体：`port(4B) + host(variable)`
- `kXR_wait` 响应体：`seconds(4B) + infomsg(variable)`

**工时**：8h

---

### 验收

- `src/protocol/message.test.ts` 通过：验证各请求帧的字节布局与 C++ 原版一致
- 验证响应解析函数正确处理各响应类型

---

## 模块三：传输层 Layer 1（Day 4）

依赖模块一。

### 3.1 ITransport 接口

**文件**：`src/transport/interface.ts`

**产出**：

```typescript
export interface ITransport {
  connect(host: string, port: number, useTls?: boolean): Promise<void>
  send(data: Buffer): Promise<void>
  onData(callback: (chunk: Buffer) => void): void
  close(): Promise<void>
  destroy(): void
}
```

### 3.2 TCP Transport 实现

**文件**：`src/transport/transport.ts`

**产出**：

```typescript
import net from 'node:net'
import tls from 'node:tls'
import type { ITransport } from './interface.js'

export class Transport implements ITransport {
  private socket: net.Socket | tls.TLSSocket | null = null

  async connect(host: string, port: number, useTls = false): Promise<void>
  send(data: Buffer): Promise<void>
  onData(callback: (chunk: Buffer) => void): void
  async close(): Promise<void>
  destroy(): void

  private tcpConnect(host: string, port: number): Promise<net.Socket>
  private tlsConnect(host: string, port: number): Promise<tls.TLSSocket>
}
```

**关键**：
- `tcpConnect` 使用 `net.connect(port, host)`
- `tlsConnect` 使用 `tls.connect({ host, port, rejectUnauthorized: false })`
- `send` 使用 `socket.write(data)` 返回 Promise
- `close` 使用 `socket.destroy()`

**工时**：4h

---

### 验收

- 能连接到 Mock Server 并完成 TCP 握手
- `src/transport/transport.test.ts` 通过

---

## 模块四：传输层 Layer 2 — Framer（Day 5-6）

依赖模块一、模块三。

### 4.1 Framer 核心逻辑

**文件**：`src/transport/framer.ts`

**产出**：

```typescript
/** 完整的 XRootD 响应帧 */
export interface Frame {
  streamId: Buffer   // 2 bytes
  status: number     // 2 bytes
  dlen: number       // 4 bytes
  body: Buffer       // dlen bytes
}

/**
 * 帧解析器：处理粘包/半包，将字节流切割为完整响应帧
 *
 * XRootD 响应格式：
 *   streamid[2] + status[2] + dlen[4] + body[dlen]
 *   固定头部 8 字节 + 变长 body
 */
export class Framer {
  private pending: Buffer

  constructor()

  /** 喂入原始字节，返回解析出的完整帧（可能 0 个或多个） */
  feed(chunk: Buffer): Frame[]
}
```

**关键实现细节**：
- `pending` 缓冲区累积数据
- 每次 `feed()` 检查是否够 8 字节头，读取 `dlen`，判断 body 是否完整
- 使用 `Buffer.allocUnsafe` 替代 `Buffer.alloc`（v1 可接受）
- `subarray` 返回视图非拷贝，Frame.body 在下一次 `feed()` 前必须被消费

### 4.2 TCP Chaos Server

**文件**：`tests/helpers/tcp-chaos-server.ts`

**产出**：

```typescript
/**
 * TCP Chaos Server：故意做 1-byte/随机切片的 TCP 测试服务器
 *
 * 用于测试 Framer 的粘包/半包处理能力
 */
export class TcpChaosServer {
  constructor(port: number)

  /** 启动服务器，接收连接 */
  start(): Promise<void>

  /** 发送指定数据，按配置的切片模式发送 */
  send(data: Buffer, options?: {
    sliceMode?: '1byte' | 'random' | 'none'
    delay?: number
  }): void

  /** 关闭服务器 */
  close(): Promise<void>
}
```

### 4.3 Framer 极端测试

**文件**：`src/transport/framer.test.ts`

**测试场景**：
1. 完整帧一次性到达
2. 1-byte 喂入：逐字节喂入完整帧
3. 随机长度切片：随机 1-10 字节切片
4. 半包边界：头部到达但 body 未完整
5. 多帧粘包：多个帧粘在一起
6. 空数据：喂入空 Buffer

**工时**：12h

---

### 验收

- Framer 能 100% 正确处理极端的 TCP 数据帧切片
- `src/transport/framer.test.ts` 全部通过

---

## 模块五：传输层 Layer 3 — Multiplexer（Day 7-8）

依赖模块一、模块四。

### 5.1 Multiplexer 核心

**文件**：`src/transport/multiplexer.ts`

**产出**：

```typescript
import type { ITransport } from './interface.js'
import { Framer, Frame } from './framer.js'

interface PendingRequest {
  resolve: (frame: Frame) => void
  reject: (err: Error) => void
  expiresAt: number
  requestId: number
  body: Uint8Array
  data?: Uint8Array
}

/**
 * 简易多路复用器
 *
 * 维护 streamid → Promise 映射
 * 发送请求时生成递增 ID，存入 Map 并挂起 Promise
 * 收到 Framer 传来的完整帧时，读取头部 ID，从 Map 取出对应 resolve 唤醒业务代码
 */
export class Multiplexer {
  private transport: ITransport
  private framer: Framer
  private pending: Map<number, PendingRequest>
  private nextStreamId: number
  private timeout: number

  constructor(transport: ITransport)

  /** 分配唯一的 streamId，检测碰撞防止覆盖 */
  private allocateStreamId(): number

  /** 发送请求并等待响应 */
  async request(requestId: number, body: Uint8Array, data?: Uint8Array): Promise<Frame>

  /** 处理接收到的帧 */
  private handleFrame(frame: Frame): void

  /** 重新发送请求（用于 kXR_wait / kXR_waitresp 重试） */
  private retryRequest(sid: number): void

  /** 扫描并清理超时的 pending 请求 */
  private sweepTimeouts(): void

  /** 设置默认超时时间 */
  setTimeout(ms: number): void

  /** 关闭 multiplexer */
  close(): void
}
```

### 5.2 kXR_wait 处理

**逻辑**：
1. 收到 `ResponseStatus.Wait` (4005)：解析 `seconds`，重置 `expiresAt`，`setTimeout` 后重试
2. 收到 `ResponseStatus.Waitresp` (4006)：解析 `seconds`，`setTimeout` 后重试原始请求
3. 重试时分配新的 streamId，重新发起请求

### 5.3 超时扫描器

**逻辑**：
- `setInterval(() => this.sweepTimeouts(), 1000).unref()`
- 每秒扫描 `pending` Map，reject 超时请求

### 5.4 streamId 碰撞检测

**逻辑**：
- 递增分配 `(sid + 1) & 0xffff`
- 分配前检查 `pending.has(sid)`，碰撞则继续递增
- 达到 65535 上限则抛出异常

### 5.5 Multiplexer 测试

**文件**：`src/transport/multiplexer.test.ts`

**测试场景**：
1. 基本请求/响应匹配
2. 多个并发请求
3. kXR_wait 重试
4. kXR_waitresp 重试
5. streamId 碰撞检测
6. 超时清理

**工时**：16h

---

### 验收

- Multiplexer 正确处理 kXR_wait/kXR_waitresp 重试
- streamId 碰撞检测正常工作
- `src/transport/multiplexer.test.ts` 全部通过

---

## 模块六：会话层 — 握手状态机（Day 9-10）

依赖模块一、模块五。

### 6.1 握手流程

**文件**：`src/session/handshake.ts`

**协议时序**：

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

### 6.2 实现

```typescript
import { Multiplexer } from '../transport/multiplexer.js'
import { XRootDUrl } from '../url/url.js'
import { PROTOCOL_VERSION, kXR_secreqs, kXR_bifreqs, kXR_ExpLogin } from '../protocol/constants.js'
import { buildHandshakeAndProtocol, buildLoginRequest, parseProtocolResponse, parseLoginResponse } from '../protocol/message.js'
import { ResponseStatus } from '../protocol/constants.js'

export interface Session {
  sessid: Uint8Array
  protocolVersion: number
  secReqs?: string
  bifReqs?: string
}

export async function handshake(
  mux: Multiplexer,
  url: XRootDUrl,
  options?: {
    username?: string
    pid?: number
  }
): Promise<Session>
```

**步骤**：
1. 发送 `buildHandshakeAndProtocol(streamId=0, flags=kXR_secreqs|kXR_bifreqs, expect=kXR_ExpLogin)`
2. 接收服务器握手响应（20 字节：ServerResponseHeader 8B + ServerInitHandShake 12B）
3. 接收 kXR_protocol 响应，解析 `pval, flags, secReqs, bifReqs`
4. 发送 `buildLoginRequest(streamId, pid, username)`
5. 接收 kXR_login 响应，提取 `sessid[16]`
6. 若 `body > 16B`，设置 `needsAuth = true`
7. 返回 `Session`

**工时**：12h

---

### 验收

- Mock Server 完成 login → 返回 sessid
- `src/session/handshake.test.ts` 通过

---

## 模块七：API 层 — File 类（Day 11）

依赖模块二、模块五、模块六。

### 7.1 File 类实现

**文件**：`src/api/file.ts`

**产出**：

```typescript
import { Multiplexer } from '../transport/multiplexer.js'
import { Session } from '../session/handshake.js'
import { buildOpenRequest, buildReadRequest, buildWriteRequest, buildCloseRequest, buildStatRequest, parseOpenResponse } from '../protocol/message.js'
import { RequestId, ResponseStatus, FHANDLE_SIZE } from '../protocol/constants.js'
import { XRootDError } from './errors.js'

export class File {
  private mux: Multiplexer
  private session: Session
  private fhandle: Uint8Array | null = null
  private _isOpen = false

  constructor(mux: Multiplexer, session: Session)

  get isOpen(): boolean

  async open(path: string, options?: {
    flags?: number
    mode?: number
  }): Promise<void>

  async read(offset: number, size: number): Promise<Uint8Array>

  async write(offset: number, data: Uint8Array): Promise<number>

  async close(): Promise<void>

  async stat(): Promise<StatInfo>
}
```

**关键实现**：
- `open()`：构建 kXR_open 请求帧，路径作为附加数据，解析响应获取 fhandle
- `read()`：构建 kXR_read 请求帧，fhandle + offset + rlen，返回响应中的数据
- `write()`：构建 kXR_write 请求帧，fhandle + offset + data，返回写入字节数
- `close()`：构建 kXR_close 请求帧，fhandle，清理内部状态
- 异常处理：kXR_error 响应 → throw `XRootDError`

### 7.2 File 集成测试

**文件**：`src/api/file.test.ts`

**测试场景**：
1. open → read → close 完整流程
2. open 不存在的文件 → throw XRootDError(NotFound)
3. read 未 open 的文件 → throw Error
4. close 后再次操作 → throw Error

**工时**：8h

---

### 验收

- Mock Server 完成 open → read(offset, size) → close
- `src/api/file.test.ts` 全部通过

---

## 模块八：端到端集成测试（Day 12）

依赖所有模块。

### 8.1 端到端读取测试

**文件**：`tests/e2e/read.test.ts`

**测试流程**：
1. 创建 Transport 实例
2. 连接到 Mock Server
3. 创建 Multiplexer
4. 执行握手（handshake）
5. 创建 File 实例
6. open 文件
7. read 数据
8. close 文件
9. 验证数据正确性

### 8.2 重定向测试

**文件**：`tests/e2e/redirect.test.ts`

**测试流程**：
1. 连接到 Mock Server A
2. 发送请求
3. 收到 kXR_redirect 响应
4. 自动重连到 Mock Server B
5. 重新执行握手
6. 重发请求
7. 验证响应

### 8.3 错误处理测试

**文件**：`tests/e2e/error.test.ts`

**测试场景**：
1. kXR_error → throw XRootDError
2. 连接断开 → reject with ClientError.Disconnected
3. 超时 → reject with timeout error

**工时**：6h

---

### 验收

- 所有 P0 测试通过
- `npm test` 全绿
- 用 Mock Server 完成：login → open → read → close

---

## 依赖关系图

```
模块一 (协议基础) ──┬──→ 模块二 (请求帧构建) ──┐
                   ├──→ 模块三 (Transport) ──→ 模块四 (Framer) ──→ 模块五 (Multiplexer) ──┬──→ 模块六 (握手) ──┐
                   │                                                                      ├──→ 模块七 (File) ──→ 模块八 (E2E)
                   └──────────────────────────────────────────────────────────────────────┘
```

---

## 关键路径

**模块一 → 模块二 → 模块五 → 模块六 → 模块七 → 模块八**

总工时约 **10-12 天**，关键路径上的阻塞风险：

1. **Framer 粘包处理**：TCP 数据切片的边界情况复杂，需要充分测试
2. **Multiplexer kXR_wait 重试**：需要理解协议的等待语义
3. **握手状态机**：协议细节多，需要仔细对照 C++ 原版实现

---

## 与现有代码的整合

现有 `src/client.ts` 中的 `XRootDClient` 类需要重构：
- 移除内联的 URL 解析（使用 `src/url/url.ts`）
- 内部持有 `Multiplexer` 实例
- 各方法（open/close/read/write）调用对应的协议请求帧构建函数
- 异常处理统一使用 `XRootDError`

---

## 测试策略

| 类型 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Node.js 内置 test runner | 编解码、Message、Framer、Multiplexer |
| 集成测试 | Mock Server (Docker) | 握手、文件操作、重定向 |
| 极端测试 | TCP Chaos Server | Framer 的 1-byte 喂入、随机切片 |

---

## 不包含

- Ring Buffer（记录在 `rust-future-optimizations.md`）
- 连接池/kXR_bind（记录在 `rust-future-optimizations.md`）
- TLS（移到 Phase 3）
- 认证框架（移到 Phase 2）
- FileSystem 类（移到 Phase 2）

---

## 验收标准

- [ ] 用 Mock Server 完成：login → open → read(offset, size) → close
- [ ] 所有 P0 请求码的编解码通过单元测试
- [ ] Framer 能够 100% 正确处理极端的 TCP 数据帧切片（1-byte 喂入、随机长度喂入）
- [ ] Multiplexer 正确处理 kXR_wait/kXR_waitresp 重试
- [ ] streamId 碰撞检测正常工作
- [ ] `npm test` 全部通过
- [ ] `npm run typecheck` 通过
