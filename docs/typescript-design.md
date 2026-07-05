# XRootD TypeScript API 设计

> 按 TypeScript 语言习惯重新设计 XRootD 客户端 API，核心目标是快速在 TS 中跑通 XRootD 协议，并为未来的 Rust 版本探路。

---

## 一、设计原则

### 1.1 消除 C++ 复杂度

| C++ 模式 | 问题 | TypeScript 解法 |
|----------|------|-----------------|
| **回调式异步** (`ResponseHandler*`) | 每个方法有 async/sync 两个重载 | `async/await`，一个签名 |
| **PIMPL** (`File → FileImpl`) | 隐藏实现，增加间接层 | 直接用 class property |
| **void\* buffer** | 手动内存管理 | `Uint8Array`，自动管理 |
| **C++ 枚举位运算** | `operator\|` 重载 | `number` 常量 + `\|` 原生支持 |
| **手动指针返回** (`StatInfo*&`) | 用户需 `delete` | 直接返回对象 |
| **timeout 参数** | 每个方法都有 `time_t timeout` | `AbortSignal` 或 option 对象 |
| **错误码+错误对象分离** | 检查 `IsOK()` 再取错误 | `throw XRootDError` 异常 |
| **插件系统** (dlopen) | 运行时动态加载 | ES Module `import` |
| **线程管理** (JobManager) | 手动创建/销毁 | Node.js Event Loop |
| **Stream ID 分配** | 手动维护 | 内部自动管理 |

### 1.2 核心原则

```
1. 协议层（二进制编解码）保持与 C++ 原版一致
2. API 层完全按 TypeScript 习惯重新设计
3. 用 async/await 替代所有回调
4. 用 throw XRootDError 替代错误码检查
5. 用 AbortSignal 替代 timeout 参数
6. 用 ES Module 替代共享库插件
```

---

## 二、三层架构

精简实现，避免五六层抽象，三层足矣：

```
┌──────────────────────────────────────────────┐
│  Layer 3: Multiplexer                        │
│  streamid → Map<number, {resolve, reject}>   │
│  请求匹配、并发控制、超时管理                   │
├──────────────────────────────────────────────┤
│  Layer 2: Framer                             │
│  粘包/半包处理、Header+Body 帧切割             │
│  将连续字节流切割为完整 XRootD 响应帧           │
├──────────────────────────────────────────────┤
│  Layer 1: Transport                          │
│  封装 net.Socket，只负责二进制数据收发          │
└──────────────────────────────────────────────┘
```

### 2.1 为什么这样设计

- **验证协议细节**：强制搞懂 XRootD 的帧结构、字节序和握手逻辑，迁移到 Rust 时 100% 可平移
- **避免 TS 性能陷阱**：没有深层对象嵌套和频繁类实例化，减轻 V8 GC 压力
- **给 Rust 留出发力空间**：连接池管理、多线程并发流控制等高级特性留给 Rust 用 tokio 完美实现

---

## 三、用户 API

### 3.1 File 类

支持两种构造方式：

```typescript
import { File, OpenFlags } from 'xrootd-client'

// 方式 A：先构造，后 open（URL 可动态决定）
const file = new File()
await file.open('root://server//data/file.dat', { flags: OpenFlags.Read })
const buffer = await file.read(0, 1024)
await file.close()

// 方式 B：构造时传入 URL（推荐常用场景）
const file = new File('root://server//data/file.dat')
await file.open({ flags: OpenFlags.Read })
const buffer = await file.read(0, 1024)
await file.close()

// 自动关闭（推荐）
await using file = new File('root://server//data/file.dat')
await file.open({ flags: OpenFlags.Read })
const buffer = await file.read(0, 1024)
// 离开作用域自动 close
```

#### 完整接口

```typescript
class File {
  constructor(url?: string)

  // 打开文件 — 两种签名
  open(url: string, options?: OpenOptions): Promise<void>
  open(options?: OpenOptions): Promise<void>

  // 核心操作
  close(): Promise<void>
  read(offset: number, size: number): Promise<Uint8Array>
  write(offset: number, data: Uint8Array): Promise<number>
  stat(infoType?: StatInfoEnum): Promise<StatInfo>
  sync(): Promise<void>
  truncate(size: number): Promise<void>

  // 向量 I/O
  vectorRead(chunks: ChunkInfo[]): Promise<ChunkInfo[]>
  vectorWrite(chunks: ChunkInfo[]): Promise<number>

  // 页面校验读写
  pgRead(offset: number, size: number): Promise<{ data: Uint8Array; crc: Uint32Array }>
  pgWrite(offset: number, data: Uint8Array): Promise<void>

  // 扩展属性
  setXAttr(attrs: ExtendedAttributes): Promise<void>
  getXAttr(attrs: string[]): Promise<ExtendedAttributes>
  delXAttr(attrs: string[]): Promise<void>
  listXAttr(): Promise<string[]>

  // 状态
  get isOpen(): boolean
}

interface OpenOptions {
  flags?: OpenFlags
  mode?: number
  signal?: AbortSignal
}
```

### 3.2 FileSystem 类

无状态的文件系统元数据操作：

```typescript
import { FileSystem } from 'xrootd-client'

const fs = new FileSystem('root://server')

// stat
const info = await fs.stat('/data/file.dat')
console.log(info.size, info.mtime, info.isDirectory)

// readdir
const entries = await fs.readdir('/data')
for (const entry of entries) {
  console.log(entry.name, entry.size, entry.flags)
}

// 目录操作
await fs.mkdir('/new/dir')
await fs.rmdir('/old/dir')
await fs.rename('/old/path', '/new/path')
await fs.rm('/old/file')

// 查询
const stats = await fs.query('stats')
const config = await fs.query('config')
```

#### 完整接口

```typescript
class FileSystem {
  constructor(url: string)

  // 定位
  locate(path: string, flags?: LocateFlags): Promise<LocationInfo>
  deepLocate(path: string, flags?: LocateFlags): Promise<LocationList>

  // 元数据
  stat(path: string, infoType?: StatInfoEnum): Promise<StatInfo>
  statVFS(path: string): Promise<StatVFSInfo>
  protocol(): Promise<ProtocolInfo>

  // 目录操作
  readdir(path: string, flags?: DirListFlags): Promise<DirectoryList>
  mkdir(path: string, mode?: number): Promise<void>
  rmdir(path: string): Promise<void>

  // 文件管理
  rename(src: string, dst: string): Promise<void>
  rm(path: string): Promise<void>
  truncate(path: string, size: number): Promise<void>
  chmod(path: string, mode: number): Promise<void>

  // 查询
  query(queryCode: string, data?: Uint8Array): Promise<Uint8Array>
  ping(): Promise<void>
  sendInfo(info: string): Promise<void>
  sendCache(path: string): Promise<void>

  // 预取
  prepare(path: string): Promise<void>

  // 扩展属性
  setXAttr(path: string, attrs: ExtendedAttributes): Promise<void>
  getXAttr(path: string, attrs: string[]): Promise<ExtendedAttributes>
  delXAttr(path: string, attrs: string[]): Promise<void>
  listXAttr(path: string): Promise<string[]>
}
```

### 3.3 错误处理

纯 throw 异常，封装为库的专有错误类型：

```typescript
import { XRootDError } from 'xrootd-client'

try {
  await file.open('root://server//nonexistent', { flags: OpenFlags.Read })
} catch (err) {
  if (err instanceof XRootDError) {
    console.log(err.code)     // 3011 (kXR_NotFound)
    console.log(err.message)  // "File not found"
    console.log(err.errno)    // POSIX errno (ENOENT)
  }
}
```

```typescript
class XRootDError extends Error {
  /** kXR 协议错误码 (3000-3035) */
  readonly code: number
  /** POSIX errno（如果服务器返回了映射） */
  readonly errno?: number

  constructor(code: number, message?: string, errno?: number)

  /** 根据错误码生成可读消息 */
  static codeToMessage(code: number): string
}
```

### 3.4 类型定义

```typescript
// 统计信息
interface StatInfo {
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

// 位置信息
interface LocationInfo {
  locations: Location[]
  get isServer(): boolean
  get isManager(): boolean
  get isRedirect(): boolean
}

// 目录列表
interface DirectoryList {
  name: string
  entries: DirectoryListInfo[]
}

// 协议信息
interface ProtocolInfo {
  version: number
  flags: number
}

// 打开标志位
const enum OpenFlags {
  Read   = 0x0010,
  Write  = 0x0020,
  Append = 0x0200,
  New    = 0x0008,
  Delete = 0x0002,
  Force  = 0x0004,
  // ...
}
```

---

## 四、内部模块实现

### 4.1 协议层

```typescript
// src/protocol/constants.ts
export const enum RequestId {
  Auth    = 3000,
  Query   = 3001,
  Chmod   = 3002,
  Close   = 3003,
  Dirlist = 3004,
  Gpfile  = 3005,
  Protocol = 3006,
  Login   = 3007,
  Mkdir   = 3008,
  Mv      = 3009,
  Open    = 3010,
  Ping    = 3011,
  Chkpoint = 3012,
  Read    = 3013,
  Rm      = 3014,
  Rmdir   = 3015,
  Sync    = 3016,
  Stat    = 3017,
  Set     = 3018,
  Write   = 3019,
  Fattr   = 3020,
  Prepare = 3021,
  Statx   = 3022,
  Endsess = 3023,
  Bind    = 3024,
  ReadV   = 3025,
  PgWrite = 3026,
  Locate  = 3027,
  Truncate = 3028,
  Sigver  = 3029,
  PgRead  = 3030,
  WriteV  = 3031,
  Clone   = 3032,
}

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
```

### 4.2 消息编解码

```typescript
// src/protocol/message.ts
export class Message {
  private buffer: Buffer
  private offset = 0

  constructor(size: number) {
    this.buffer = Buffer.alloc(size)
  }

  writeInt32BE(value: number): void {
    this.buffer.writeInt32BE(value, this.offset)
    this.offset += 4
  }

  writeInt16BE(value: number): void {
    this.buffer.writeInt16BE(value, this.offset)
    this.offset += 2
  }

  writeBytes(data: Uint8Array): void {
    Buffer.from(data).copy(this.buffer, this.offset)
    this.offset += data.length
  }

  readInt32BE(): number {
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readInt16BE(): number {
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readBytes(length: number): Buffer {
    const data = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return data
  }

  getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset)
  }
}
```

### 4.3 传输层（Layer 1）

```typescript
// src/transport/interface.ts
export interface ITransport {
  connect(host: string, port: number, useTls?: boolean): Promise<void>
  send(data: Buffer): Promise<void>
  onData(callback: (chunk: Buffer) => void): void
  close(): Promise<void>
}
```

```typescript
// src/transport/transport.ts
import net from 'node:net'
import tls from 'node:tls'
import type { ITransport } from './interface.js'

export class Transport implements ITransport {
  private socket: net.Socket | tls.TLSSocket | null = null

  async connect(host: string, port: number, useTls = false): Promise<void> {
    this.socket = useTls
      ? await this.tlsConnect(host, port)
      : await this.tcpConnect(host, port)
  }

  send(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket!.write(data, (err) => err ? reject(err) : resolve())
    })
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.socket!.on('data', callback)
  }

  async close(): Promise<void> {
    this.socket?.destroy()
    this.socket = null
  }

  private tcpConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => resolve(socket))
      socket.on('error', reject)
    })
  }

  private tlsConnect(host: string, port: number): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => resolve(socket))
      socket.on('error', reject)
    })
  }
}
```

### 4.4 帧解析器（Layer 2）

```typescript
// src/transport/framer.ts

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
  private pending = Buffer.alloc(0)

  /** 喂入原始字节，返回解析出的完整帧（可能 0 个或多个） */
  feed(chunk: Buffer): Frame[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const frames: Frame[] = []

    while (this.pending.length >= 8) {
      const dlen = this.pending.readUInt32BE(4)
      if (this.pending.length < 8 + dlen) break  // body 不够，等下一个 chunk

      frames.push({
        streamId: this.pending.subarray(0, 2),
        status: this.pending.readUInt16BE(2),
        dlen,
        body: this.pending.subarray(8, 8 + dlen),
      })
      this.pending = this.pending.subarray(8 + dlen)
    }

    return frames
  }
}
```

#### 性能说明

**Buffer.alloc vs Buffer.allocUnsafe**：当前 `pending` 初始化使用 `Buffer.alloc(0)`（零填充）。生产实现中可改用 `Buffer.allocUnsafe` 避免零填充开销——Framer 内部立即覆写数据，不存在安全风险。

**Buffer.concat 的 GC 压力**：`feed()` 中的 `Buffer.concat([this.pending, chunk])` 每次调用都分配新 Buffer，在高吞吐场景下会产生显著 GC 压力。v1 可接受，Rust 版应使用 `bytes::BytesMut` 实现零拷贝。

**subarray 视图**：`this.pending.subarray(8 + dlen)` 返回的是同一底层内存的视图（非拷贝），Frame.body 在下一次 `feed()` 调用前必须被消费。

### 4.5 简易多路复用器（Layer 3）

```typescript
// src/transport/multiplexer.ts
import type { ITransport } from './interface.js'
import { Framer, Frame } from './framer.js'
import { Message } from '../protocol/message.js'
import { ResponseStatus } from '../protocol/constants.js'

interface PendingRequest {
  resolve: (frame: Frame) => void
  reject: (err: Error) => void
  expiresAt: number
  // 保存原始请求参数，用于 kXR_wait/kXR_waitresp 重试
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
  private pending = new Map<number, PendingRequest>()
  private nextStreamId = 0
  private timeout = 30000  // 默认 30s 超时

  constructor(transport: ITransport) {
    this.transport = transport
    this.framer = new Framer()

    // 全局超时扫描器，每秒检查一次过期请求
    setInterval(() => this.sweepTimeouts(), 1000).unref()

    // 监听原始数据，喂给 Framer 解析
    this.transport.onData((chunk) => {
      const frames = this.framer.feed(chunk)
      for (const frame of frames) {
        this.handleFrame(frame)
      }
    })
  }

  /** 分配唯一的 streamId，检测碰撞防止覆盖 */
  private allocateStreamId(): number {
    let sid = this.nextStreamId
    while (this.pending.has(sid)) {
      sid = (sid + 1) & 0xffff
      if (sid === this.nextStreamId) {
        throw new Error('Max concurrent requests (65535) reached')
      }
    }
    this.nextStreamId = (sid + 1) & 0xffff
    return sid
  }

  /** 发送请求并等待响应 */
  async request(requestId: number, body: Uint8Array, data?: Uint8Array): Promise<Frame> {
    const sid = this.allocateStreamId()

    // 构建请求帧：streamid[2] + requestid[2] + body[16] + dlen[4] + data
    const bodyBuf = Buffer.alloc(16)
    Buffer.from(body).copy(bodyBuf)

    const msg = new Message(24 + (data?.length ?? 0))
    // streamid
    msg.writeBytes(new Uint8Array([(sid >> 8) & 0xff, sid & 0xff]))
    // requestid
    msg.writeInt16BE(requestId)
    // body (16 bytes)
    msg.writeBytes(bodyBuf)
    // dlen
    msg.writeInt32BE(data?.length ?? body.length)
    // 追加数据
    if (data && data.length > 0) {
      msg.writeBytes(data)
    }

    return new Promise<Frame>((resolve, reject) => {
      this.pending.set(sid, {
        resolve,
        reject,
        expiresAt: Date.now() + this.timeout,
        requestId,
        body,
        data,
      })
      this.transport.send(msg.getBuffer()).catch(reject)
    })
  }

  private handleFrame(frame: Frame): void {
    const sid = (frame.streamId[0] << 8) | frame.streamId[1]

    // kXR_wait (4005): 服务器要求等待指定秒数后重试
    if (frame.status === ResponseStatus.Wait) {
      const seconds = frame.body.readInt32BE(0)
      const pending = this.pending.get(sid)
      if (pending) {
        // 重置过期时间，等 seconds 秒后由 sweepTimeouts 或手动重试
        pending.expiresAt = Date.now() + seconds * 1000
        setTimeout(() => this.retryRequest(sid), seconds * 1000)
      }
      return
    }

    // kXR_waitresp (4006): 等待后重试原始请求
    if (frame.status === ResponseStatus.Waitresp) {
      const seconds = frame.body.readInt32BE(0)
      const pending = this.pending.get(sid)
      if (pending) {
        setTimeout(() => this.retryRequest(sid), seconds * 1000)
      }
      return
    }

    // 正常响应
    const pending = this.pending.get(sid)
    if (!pending) return
    this.pending.delete(sid)
    pending.resolve(frame)
  }

  /** 重新发送请求（用于 kXR_wait / kXR_waitresp 重试） */
  private retryRequest(sid: number): void {
    const pending = this.pending.get(sid)
    if (!pending) return
    this.pending.delete(sid)
    // 重新发起请求，分配新的 streamId
    this.request(pending.requestId, pending.body, pending.data)
      .then(pending.resolve)
      .catch(pending.reject)
  }

  /** 扫描并清理超时的 pending 请求 */
  private sweepTimeouts(): void {
    const now = Date.now()
    for (const [sid, req] of this.pending.entries()) {
      if (now > req.expiresAt) {
        this.pending.delete(sid)
        req.reject(new Error(`Request timeout: streamid=${sid}`))
      }
    }
  }

  setTimeout(ms: number): void {
    this.timeout = ms
  }
}
```

---

## 五、关键实现细节

### 5.1 握手状态机

```typescript
// src/session/handshake.ts
import { Multiplexer } from '../transport/multiplexer.js'
import { Message } from '../protocol/message.js'
import { RequestId, ResponseStatus } from '../protocol/constants.js'

const PROTOCOL_VERSION = 0x00000520  // 5.2.0

export async function handshake(mux: Multiplexer): Promise<Uint8Array> {
  // Step 1: 发送初始握手(20B) + kXR_protocol(24B) 合并为 44 字节
  const initHs = new Message(44)
  // ClientInitHandShake (20B)
  initHs.writeInt32BE(0)             // first = 0
  initHs.writeInt32BE(0)             // second = 0
  initHs.writeInt32BE(0)             // third = 0
  initHs.writeInt32BE(4)             // fourth = htonl(4)
  initHs.writeInt32BE(2012)          // fifth = htonl(2012)
  // kXR_protocol request (24B)
  const protoReq = new Message(24)
  protoReq.writeBytes(new Uint8Array(2))  // streamid = 0
  protoReq.writeInt16BE(RequestId.Protocol)
  protoReq.writeInt32BE(PROTOCOL_VERSION) // clientpv
  protoReq.writeInt32BE(0)                // clientpv 高位 + flags
  // ... flags, expect, reserved, dlen 字段

  // Step 2: 接收服务器握手响应帧 (ServerResponseHeader.dlen 与 ServerInitHandShake.msglen 共享，总计 16B)
  // 由 Framer 处理

  // Step 3: 接收 kXR_protocol 响应
  // 解析 pval, flags, secReqs, bifReqs

  // Step 4: 发送 kXR_login 请求
  // pid + username + ability + CGI

  // Step 5: 接收 kXR_login 响应
  // 提取 16 字节 sessid
  // 如果 body > 16 字节，额外数据是安全需求 → 需要认证

  // Step 6: [可选] kXR_auth 多轮认证
  // 直到收到 kXR_ok

  // 返回 sessionId
  return sessionId
}
```

### 5.2 重定向自动处理

```typescript
// Multiplexer 内部处理
if (frame.status === ResponseStatus.Redirect) {
  // 解析 ServerResponseBody_Redirect: port(4B) + host(variable)
  const port = frame.body.readInt32BE(0)
  const host = frame.body.subarray(4).toString().replace(/\0+$/, '')

  // 重新连接到新地址
  await this.transport.close()
  await this.transport.connect(host, port)

  // 重新握手
  await handshake(this)

  // 重试请求
  return this.request(requestId, body, data)
}
```

### 5.3 超时控制（AbortSignal）

```typescript
class File {
  async open(url: string, options?: OpenOptions): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    // ... 发送请求

    // 监听 abort 事件
    signal?.addEventListener('abort', () => {
      // 取消挂起的请求
    }, { once: true })
  }
}
```

### 5.4 TLS 升级

TLS 升级在 kXR_protocol 交换期间通过 flags 字段协商：

```
kXR_secreqs = 0x01  — 请求服务器安全需求
kXR_ableTLS = 0x02  — 声明客户端支持 TLS
kXR_wantTLS = 0x04  — 请求切换到 TLS
```

如果服务器要求 TLS，客户端重新发送 kXR_protocol（带 `kXR_wantTLS` 标志），然后通过 `node:tls` 升级连接。

### 5.5 断线重连与文件句柄失效

当底层连接断开并重新握手后，**旧 Session 的所有文件句柄（fhandle）均失效**。
客户端不会自动恢复这些句柄——这是应用层的责任。

**行为规范**：
- 连接断开时，所有 pending 请求的 Promise 被 reject，错误码为 `ClientError.Disconnected`
- `File` 类在检测到 `Disconnected` 错误时，应将内部 `fhandle` 置为 null
- 用户需重新 `open()` 获取新 `fhandle`；如需从断点继续，应记录 offset

**不自动重放的原因**：
- `kXR_open` 可能带有幂等性语义冲突（如 `kXR_new` 标志会创建新文件）
- 文件可能在断开期间被移动/删除
- 用户可能不希望自动重试（例如已切换到另一个操作）

---

## 六、C++ → TS 模块映射

### 6.1 协议层（P0）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XProtocol/XPtypes.hh` | `src/protocol/types.ts` | 基础类型 |
| `XProtocol/XProtocol.hh` | `src/protocol/constants.ts` | 请求码、响应码、错误码 |
| `XProtocol/XProtocol.cc` | `src/protocol/utils.ts` | errno 映射、错误名查找 |

### 6.2 传输层（P0）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClXRootDTransport.hh/cc` | `src/session/handshake.ts` | 握手状态机 |
| `XrdCl/XrdClMessage.hh/cc` | `src/protocol/message.ts` | 消息编解码 |
| `XrdCl/XrdClBuffer.hh` | Node.js `Buffer` | 无需实现 |
| `XrdCl/XrdClSocket.hh/cc` | `src/transport/transport.ts` | TCP 连接封装 |
| `XrdCl/XrdClTls.hh/cc` | `node:tls` | 无需实现 |

### 6.3 连接管理（P1）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClPostMaster.hh/cc` | `src/transport/multiplexer.ts` | 简化为 Multiplexer |
| `XrdCl/XrdClChannel.hh/cc` | 合并到 `transport.ts` | — |
| `XrdCl/XrdClStream.hh/cc` | 合并到 `framer.ts` + `multiplexer.ts` | — |
| `XrdCl/XrdClAsyncSocketHandler.hh/cc` | Node.js 事件循环 | 无需实现 |
| `XrdCl/XrdClPoller*.hh/cc` | Node.js Event Loop | 无需实现 |
| `XrdCl/XrdClSIDManager.hh/cc` | Multiplexer 内部计数器 | 简化为属性 |

### 6.4 用户 API（P1）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClFile.hh/cc` | `src/api/file.ts` | 重新设计为 async/await |
| `XrdCl/XrdClFileSystem.hh/cc` | `src/api/filesystem.ts` | 重新设计为 async/await |
| `XrdCl/XrdClXRootDResponses.hh/cc` | `src/api/types.ts` | StatInfo, LocationInfo 等 |
| `XrdCl/XrdClStatus.hh/cc` | `src/api/errors.ts` | XRootDError 类 |
| `XrdCl/XrdClURL.hh/cc` | `src/url/url.ts` | URL 解析 |
| `XrdCl/XrdClBuffer.hh` | `Uint8Array` | 无需实现 |
| `XrdCl/XrdClPropertyList.hh` | `Record<string, unknown>` | 无需实现 |
| `XrdCl/XrdClOptional.hh` | TypeScript `?` 语法 | 无需实现 |

### 6.5 可跳过的文件（P2-P3）

| C++ 文件 | 原因 |
|----------|------|
| `XrdCl/XrdClCopyProcess.*` | 复制过程管理，v1.5+ |
| `XrdCl/XrdClClassicCopyJob.*` | 经典复制任务 |
| `XrdCl/XrdClThirdPartyCopyJob.*` | 第三方复制 |
| `XrdCl/XrdClEcHandler.*` | 纠删码处理器 |
| `XrdCl/XrdClZipArchive.*` | ZIP 支持 |
| `XrdCl/XrdClOperations.*` | 声明式操作框架 |
| `XrdCl/XrdClMetalinkRedirector.*` | Metalink 重定向 |
| `XrdCl/XrdClMonitor.*` | 监控接口 |
| `XrdCl/XrdClLocalFileHandler.*` | 本地文件处理 |
| `XrdCl/XrdClAsyncHSReader/Writer.*` | 异步握手读写 |
| `XrdCl/XrdClAsyncMsgReader/Writer.*` | 异步消息读写 |

---

## 七、协议流程图

### 7.1 握手流程（修正版）

```
客户端                                      服务器
  |  1. TCP Connect                           |
  |─────────────────────────────────────────>|
  |                                           |
  |  2. ClientInitHandShake (20B)             |
  |     + kXR_protocol (24B)  [合并发送]       |
  |     fourth=4, fifth=2012                  |
  |─────────────────────────────────────────>|
  |                                           |
  |  3. ServerResponseHeader (8B)             |
  |     + ServerInitHandShake (12B)           |
  |     (dlen/msglen 字段共享，总计 16B)        |
  |<─────────────────────────────────────────|
  |                                           |
  |  4. kXR_ok + Protocol Response            |
  |<─────────────────────────────────────────|
  |                                           |
  |  5. kXR_login 请求                         |
  |     pid + username + ability + CGI        |
  |─────────────────────────────────────────>|
  |                                           |
  |  6. kXR_ok + Login Response               |
  |     sessid[16] + secToken (可选)           |
  |<─────────────────────────────────────────|
  |                                           |
  |  7. [可选] kXR_auth 多轮认证               |
  |<────────────────────────────────────────>|
  |                                           |
  |  ===== 会话建立完毕 =====                   |
```

### 7.2 文件读取流程

```
客户端                                      服务器
  |  Open Request (kXR_open)                  |
  |  + path, flags, mode                      |
  |─────────────────────────────────────────>|
  |  Open Response                            |
  |  + fhandle[4]                             |
  |<─────────────────────────────────────────|
  |                                           |
  |  Read Request (kXR_read)                  |
  |  + fhandle, offset[8], rlen               |
  |─────────────────────────────────────────>|
  |  Read Response                            |
  |  + data[dlen]                             |
  |<─────────────────────────────────────────|
  |                                           |
  |  Close Request (kXR_close)                |
  |  + fhandle                                |
  |─────────────────────────────────────────>|
  |  Close Response                           |
  |<─────────────────────────────────────────|
```

### 7.3 重定向处理

```
客户端                                      服务器 A
  |  Read Request                             |
  |─────────────────────────────────────────>|
  |                                           |
  |  Redirect Response                        |
  |  + newhost, newport                       |
  |<─────────────────────────────────────────|
  |                                           |
  |  (自动重连到 Server B)                     |
  |  TCP Connect → HandShake → Login          |
  |─────────────────────────────────────────>│  Server B
  |  重新发送 Read Request                     |
  |─────────────────────────────────────────>|
  |  Read Response                            |
  |<─────────────────────────────────────────|
```

---

## 八、第三方库替代清单

| C++ 模块 | TypeScript 替代 | 用途 |
|----------|----------------|------|
| `XrdSys` | Node.js 内置 | 线程、同步、日志 |
| `XrdNet` | `node:net` / `node:dns` | TCP 连接、DNS 解析 |
| `XrdTls` | `node:tls` | TLS/SSL 加密 |
| `XrdOuc` | 自实现（少量工具函数） | URL 解析、字符串处理 |
| `XrdXml` | `fast-xml-parser` | Metalink XML 解析（可选） |
| `ZLIB` | `node:zlib` | 数据压缩 |
| `OpenSSL` | `node:crypto` | 加密、哈希 |
| `uuid` | `uuid` 包 | UUID 生成 |

---

## 九、总结

| 方面 | C++ 原版 | TypeScript 原生 |
|------|---------|----------------|
| **文件数** | 138 个 | ~15 个 |
| **代码量** | ~15,000 行 | ~2,000 行 |
| **异步模型** | 回调 + 状态机 | async/await |
| **错误处理** | 错误码检查 | throw XRootDError |
| **内存管理** | 手动 new/delete | 自动 GC |
| **类型安全** | 运行时检查 | 编译时类型检查 |
| **插件系统** | dlopen 共享库 | ES Module import |
| **流式 I/O** | 自定义缓冲区 | Node.js Stream |
| **连接管理** | 5 层抽象 | 3 层精简架构 |

核心协议逻辑（握手、编解码、认证流程）保持不变，API 表面完全按 TypeScript 习惯重新设计，同时为未来 Rust 迁移保留 100% 可平移的协议知识。
