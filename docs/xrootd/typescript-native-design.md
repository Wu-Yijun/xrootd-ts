# XRootD TypeScript 原生 API 设计

> 不是一比一复刻 C++ 接口，而是按 TypeScript 语言习惯重新设计。

---

## 一、C++ 原版复杂度来源（需要消除的）

| C++ 模式 | 问题 | TypeScript 解法 |
|----------|------|-----------------|
| **回调式异步** (`ResponseHandler*`) | 每个方法有 async/sync 两个重载 | `async/await`，一个签名 |
| **PIMPL** (`File → FileImpl`) | 隐藏实现，增加间接层 | 直接用 class property |
| **void\* buffer** | 手动内存管理 | `Uint8Array`，自动管理 |
| **C++ 枚举位运算** (`OpenFlags::Flags`) | `operator\|` 重载 | `number` 常量 + `\|` 原生支持 |
| **手动指针返回** (`StatInfo*&`) | 用户需 `delete` | 直接返回对象 |
| **timeout 参数** | 每个方法都有 `time_t timeout` | `AbortSignal` 或 option 对象 |
| **错误码+错误对象分离** (`XRootDStatus`) | 检查 `IsOK()` 再取错误 | `throw` 异常或 `Result<T>` 类型 |
| **插件系统** (共享库 dlopen) | 运行时动态加载 | ES Module `import` |
| **线程管理** (JobManager 线程池) | 手动创建/销毁 | Node.js Event Loop |
| **Stream ID 分配** | 手动维护 | 内部自动管理 |

---

## 二、TypeScript 原生 API 设计

### 2.1 核心原则

```
1. 协议层（二进制编解码）保持不变
2. API 层完全按 TypeScript 习惯重新设计
3. 用 async/await 替代所有回调
4. 用 class + getter/setter 替代 PIMPL
5. 用 AbortSignal 替代 timeout 参数
6. 用 throw 替代错误码检查
7. 用 ES Module 替代共享库插件
```

### 2.2 整体架构

```
用户代码
  │
  ├── import { RootFile, RootFileSystem } from 'xrootd-client'
  │
  ├── const file = new RootFile()
  │   ├── await file.open('root://server//path', { flags: 'read' })
  │   ├── const data = await file.read(offset, size)
  │   └── await file.close()
  │
  └── const fs = new RootFileSystem('root://server')
      ├── const info = await fs.stat('/path')
      ├── const list = await fs.readdir('/dir')
      └── await fs.mkdir('/newdir')

内部层次：
┌──────────────────────────────────┐
│  RootFile / RootFileSystem       │  ← 用户 API（TypeScript 风格）
├──────────────────────────────────┤
│  Client                         │  ← 连接管理（单例或注入）
├──────────────────────────────────┤
│  Transport                      │  ← 协议编解码（保持 C++ 逻辑）
├──────────────────────────────────┤
│  net.Socket / tls.TLSSocket     │  ← Node.js 内置
└──────────────────────────────────┘
```

### 2.3 用户 API 设计

#### File 操作

```typescript
import { RootFile, OpenFlags } from 'xrootd-client'

// 基本用法
const file = new RootFile()
await file.open('root://server//data/file.dat', { flags: OpenFlags.Read })
const buffer = await file.read(0, 1024)
await file.close()

// 或者用 autoClose（推荐）
await using file = new RootFile()
await file.open('root://server//data/file.dat', { flags: OpenFlags.Read })
const buffer = await file.read(0, 1024)
// 离开作用域自动 close

// 带选项
await file.open('root://server//new/file.dat', {
  flags: OpenFlags.Write | OpenFlags.New,
  mode: 0o644,
  timeout: 5000,           // 毫秒
  signal: AbortSignal.timeout(5000),  // 或用 AbortSignal
})

// 错误处理（异常方式）
try {
  await file.open('root://server//nonexistent', { flags: OpenFlags.Read })
} catch (err) {
  if (err instanceof XRootDError) {
    console.log(err.code)     // 301 (kXR_errNotFound)
    console.log(err.message)  // "File not found"
    console.log(err.errno)    // POSIX errno (ENOENT)
  }
}

// 或者用 Result 模式（可选）
const result = await file.open('root://server//path', { flags: OpenFlags.Read })
if (result.ok) {
  // 成功
} else {
  console.log(result.error.code)
}
```

#### FileSystem 操作

```typescript
import { RootFileSystem } from 'xrootd-client'

const fs = new RootFileSystem('root://server')

// stat
const info = await fs.stat('/data/file.dat')
console.log(info.size, info.mtime, info.isDirectory)

// readdir
const entries = await fs.readdir('/data')
for (const entry of entries) {
  console.log(entry.name, entry.size, entry.flags)
}

// mkdir / rmdir / rename / remove
await fs.mkdir('/new/dir', { recursive: true })
await fs.rm('/old/file')
await fs.rename('/old/path', '/new/path')

// query
const stats = await fs.query('stats')
const config = await fs.query('config')
```

#### 流式读写（Node.js 风格）

```typescript
import { createReadStream, createWriteStream } from 'xrootd-client'

// 读取流
const readStream = createReadStream('root://server//data/file.dat', {
  highWaterMark: 64 * 1024,
})
for await (const chunk of readStream) {
  process.stdout.write(chunk)
}

// 写入流
const writeStream = createWriteStream('root://server//output/file.dat')
writeStream.write(chunk1)
writeStream.write(chunk2)
writeStream.end()

// pipe
createReadStream('root://server//src')
  .pipe(createWriteStream('root://server//dst'))
```

### 2.4 内部模块设计

#### 协议层（保持 C++ 逻辑）

```typescript
// src/protocol.ts — 对应 XProtocol.hh
export const enum RequestId {
  Auth    = 3000,
  Query   = 3001,
  Chmod   = 3002,
  Close   = 3003,
  Dirlist = 3004,
  Login   = 3007,
  Mkdir   = 3008,
  Mv      = 3009,
  Open    = 3010,
  Ping    = 3011,
  Read    = 3013,
  Rm      = 3014,
  Rmdir   = 3015,
  Sync    = 3016,
  Stat    = 3017,
  Write   = 3019,
  ReadV   = 3025,
  PgRead  = 3030,
  WriteV  = 3031,
}

export const enum ResponseStatus {
  Ok       = 0,
  Oksofar  = 4000,
  Attn     = 4001,
  Error    = 4003,
  Redirect = 4004,
  Wait     = 4005,
}

// 请求头（固定 20 字节）
export interface RequestHeader {
  streamId: Uint8Array  // 2 bytes
  requestId: number     // 2 bytes
  body: Uint8Array      // 16 bytes
  dlen: number          // 4 bytes
}
```

#### 消息编解码

```typescript
// src/message.ts — 对应 XrdClMessage
export class Message {
  private buffer: Buffer
  private offset = 0

  constructor(size: number) {
    this.buffer = Buffer.alloc(size)
  }

  // 写入大端整数
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

  // 读取大端整数
  readInt32BE(): number {
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset)
  }
}
```

#### 传输层

```typescript
// src/transport.ts — 对应 XrdClXRootDTransport
import net from 'node:net'
import tls from 'node:tls'
import { Message } from './message'
import { RequestId, ResponseStatus } from './protocol'

export class Transport {
  private socket: net.Socket | tls.TLSSocket
  private sessionId: Uint8Array | null = null
  private streamId = 0

  constructor(private url: URL) {}

  // 握手 + Login（合并为一步）
  async connect(options?: { tls?: boolean; signal?: AbortSignal }): Promise<void> {
    // 1. TCP 连接
    this.socket = await this.tcpConnect(this.url.hostname, this.url.port)

    // 2. 初始握手
    const hs = new Message(20)
    hs.writeInt32BE(0)  // first
    hs.writeInt32BE(0)  // second
    hs.writeInt32BE(0x00000520)  // third = protocol version
    hs.writeInt32BE(0)  // fourth
    hs.writeInt32BE(0)  // fifth
    await this.send(hs.getBuffer())

    // 3. 接收服务器握手
    const serverHs = await this.receive(12)
    const msglen = serverHs.readInt32BE(0)
    const protover = serverHs.readInt32BE(4)

    // 4. Protocol 请求
    await this.sendRequest(RequestId.Protocol, new Uint8Array(0))
    await this.receiveResponse()

    // 5. Login
    const loginBody = new Message(16)
    loginBody.writeBytes(new TextEncoder().encode(this.url.hostname.padEnd(8, '\0')))
    await this.sendRequest(RequestId.Login, loginBody.getBuffer())
    const loginResp = await this.receiveResponse()
    this.sessionId = loginResp.subarray(4, 20)  // 16 bytes session ID
  }

  // 发送请求
  async sendRequest(requestId: RequestId, body: Uint8Array): Promise<void> {
    const msg = new Message(20 + body.length)
    // streamId: 2 bytes (自动分配)
    const sid = new Uint8Array(2)
    sid[0] = (this.streamId >> 8) & 0xff
    sid[1] = this.streamId & 0xff
    this.streamId = (this.streamId + 1) & 0xffff
    msg.writeBytes(sid)
    // requestId: 2 bytes
    msg.writeInt16BE(requestId)
    // body: 16 bytes (填充在请求头的 body 字段)
    msg.writeBytes(body.subarray(0, Math.min(body.length, 16)))
    // dlen: 4 bytes
    msg.writeInt32BE(body.length)
    // 如果 body 超过 16 字节，追加到后面
    if (body.length > 16) {
      msg.writeBytes(body.subarray(16))
    }
    await this.send(msg.getBuffer())
  }

  private async tcpConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => resolve(socket))
      socket.on('error', reject)
    })
  }

  private async send(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => err ? reject(err) : resolve())
    })
  }

  private async receive(size: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let received = 0
      const onData = (chunk: Buffer) => {
        chunks.push(chunk)
        received += chunk.length
        if (received >= size) {
          this.socket.removeListener('data', onData)
          resolve(Buffer.concat(chunks).subarray(0, size))
        }
      }
      this.socket.on('data', onData)
      this.socket.on('error', reject)
    })
  }
}
```

#### 连接管理

```typescript
// src/client.ts — 对应 XrdClPostMaster
import { Transport } from './transport'

export class Client {
  private connections = new Map<string, Transport>()

  constructor(private options?: { tls?: boolean }) {}

  async getConnection(url: string): Promise<Transport> {
    const parsed = new URL(url)
    const key = `${parsed.hostname}:${parsed.port}`

    let transport = this.connections.get(key)
    if (!transport) {
      transport = new Transport(parsed)
      await transport.connect(this.options)
      this.connections.set(key, transport)
    }
    return transport
  }

  async closeAll(): Promise<void> {
    for (const transport of this.connections.values()) {
      await transport.close()
    }
    this.connections.clear()
  }
}
```

#### File 实现

```typescript
// src/file.ts — 对应 XrdClFile
import { Client } from './client'
import { RequestId, ResponseStatus } from './protocol'

export interface OpenOptions {
  flags?: OpenFlags
  mode?: number
  timeout?: number
  signal?: AbortSignal
}

export class RootFile {
  private client: Client
  private url: string
  private handle: Uint8Array | null = null

  constructor(client?: Client) {
    this.client = client ?? defaultClient
  }

  async open(url: string, options?: OpenOptions): Promise<void> {
    this.url = url
    const transport = await this.client.getConnection(url)

    // 构建 open 请求体
    const body = new Message(16)
    body.writeBytes(new TextEncoder().encode(url.path.padEnd(16, '\0')))
    body.writeInt16BE(options?.flags ?? OpenFlags.Read)

    const response = await transport.sendRequest(RequestId.Open, body.getBuffer())
    this.handle = response.subarray(4, 8)  // 4 bytes file handle
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this.handle) throw new Error('File not open')
    const transport = await this.client.getConnection(this.url)

    const body = new Message(16)
    body.writeBytes(this.handle)
    // offset: 8 bytes at body[4..12]
    body.writeInt32BE(0)  // 高 32 位
    body.writeInt32BE(offset)  // 低 32 位
    // dlen: 4 bytes at body[12..16]
    body.writeInt32BE(size)

    const response = await transport.sendRequest(RequestId.Read, body.getBuffer())
    return response.subarray(20)  // 跳过响应头
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (!this.handle) throw new Error('File not open')
    const transport = await this.client.getConnection(this.url)

    const body = new Message(16)
    body.writeBytes(this.handle)
    body.writeInt32BE(0)
    body.writeInt32BE(offset)
    body.writeInt32BE(data.length)

    await transport.sendRequest(RequestId.Write, body, data)
  }

  async close(): Promise<void> {
    if (!this.handle) return
    const transport = await this.client.getConnection(this.url)

    const body = new Message(16)
    body.writeBytes(this.handle)
    await transport.sendRequest(RequestId.Close, body.getBuffer())
    this.handle = null
  }

  // Symbol.dispose 支持（TC39 提案）
  [Symbol.dispose](): void {
    this.close().catch(() => {})
  }
}
```

---

## 三、与 C++ 原版的对比

### 3.1 File 操作对比

```cpp
// C++ 原版（async + callback）
XrdCl::File file;
XRootDStatus st = file.Open("root://server//path",
                             XrdCl::OpenFlags::Read,
                             XrdCl::Access::None,
                             &handler);  // callback

// C++ 原版（sync）
XRootDStatus st = file.Open("root://server//path",
                             XrdCl::OpenFlags::Read);
```

```typescript
// TypeScript 原生
const file = new RootFile()
await file.open('root://server//path', { flags: OpenFlags.Read })

// 或者用 autoClose
await using file = new RootFile()
await file.open('root://server//path', { flags: OpenFlags.Read })
```

### 3.2 错误处理对比

```cpp
// C++ 原版
XRootDStatus st = file.Read(offset, size, buffer, bytesRead);
if (!st.IsOK()) {
  if (st.code == errNotFound) { ... }
  else if (st.code == errPermission) { ... }
}
```

```typescript
// TypeScript 原生（异常方式）
try {
  const data = await file.read(offset, size)
} catch (err) {
  if (err.code === 'kXR_errNotFound') { ... }
  else if (err.code === 'kXR_errPermission') { ... }
}

// 或者用 Result 模式
const result = await file.read(offset, size)
if (!result.ok) {
  if (result.error.code === 'kXR_errNotFound') { ... }
}
```

### 3.3 流式读取对比

```cpp
// C++ 原版（需要手动管理缓冲区和回调）
void *buffer = malloc(size);
file.Read(offset, size, buffer, handler);
// 在 handler 中处理数据...
free(buffer);
```

```typescript
// TypeScript 原生（Node.js Stream）
const stream = createReadStream('root://server//file')
for await (const chunk of stream) {
  // 自动管理缓冲区
}
```

---

## 四、C++ 文件 → TypeScript 模块映射

### 4.1 协议层（P0，必须逐字段翻译）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XProtocol/XPtypes.hh` | `src/protocol/types.ts` | 基础类型（kXR_int32 等） |
| `XProtocol/XProtocol.hh` | `src/protocol/constants.ts` | 请求码、响应码、错误码、请求/响应结构体 |
| `XProtocol/XProtocol.cc` | `src/protocol/utils.ts` | errno 映射、错误名查找 |

### 4.2 传输层（P0，保持协议逻辑，重写 API）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClXRootDTransport.hh/cc` | `src/transport/transport.ts` + `handshake.ts` | 握手状态机、消息编解码 |
| `XrdCl/XrdClMessage.hh/cc` | `src/protocol/message.ts` | 消息封装 |
| `XrdCl/XrdClBuffer.hh` | 使用 Node.js `Buffer` | 无需实现 |
| `XrdCl/XrdClSocket.hh/cc` | 使用 `node:net` | 无需实现 |
| `XrdCl/XrdClTls.hh/cc` | 使用 `node:tls` | 无需实现 |

### 4.3 连接管理（P1，大幅简化）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClPostMaster.hh/cc` | `src/connection/client.ts` | 简化为 Map<URL, Transport> |
| `XrdCl/XrdClChannel.hh/cc` | 合并到 `transport.ts` | 单子流简化 |
| `XrdCl/XrdClStream.hh/cc` | 合并到 `transport.ts` | 单子流简化 |
| `XrdCl/XrdClAsyncSocketHandler.hh/cc` | 使用 Node.js 事件循环 | 无需实现 |
| `XrdCl/XrdClPoller*.hh/cc` | 使用 Node.js Event Loop | 无需实现 |
| `XrdCl/XrdClTaskManager.hh/cc` | 使用 `setTimeout`/`setInterval` | 无需实现 |
| `XrdCl/XrdClJobManager.hh/cc` | 使用 Node.js Worker Threads | 无需实现 |
| `XrdCl/XrdClInQueue.hh/cc` | 使用 Promise map | 简化实现 |
| `XrdCl/XrdClOutQueue.hh/cc` | 使用数组队列 | 简化实现 |
| `XrdCl/XrdClSIDManager.hh/cc` | 内部 streamId 计数器 | 简化为属性 |

### 4.4 用户 API（P1，完全重新设计）

| C++ 文件 | TS 模块 | 说明 |
|----------|---------|------|
| `XrdCl/XrdClFile.hh/cc` | `src/api/file.ts` | 重新设计为 async/await |
| `XrdCl/XrdClFileSystem.hh/cc` | `src/api/filesystem.ts` | 重新设计为 async/await |
| `XrdCl/XrdClXRootDResponses.hh/cc` | `src/api/types.ts` | StatInfo, LocationInfo 等 |
| `XrdCl/XrdClStatus.hh/cc` | `src/api/errors.ts` | XRootDError 类 |
| `XrdCl/XrdClURL.hh/cc` | `src/api/url.ts` | URL 解析 |
| `XrdCl/XrdClEnv.hh/cc` | `src/connection/options.ts` | 全局配置 |
| `XrdCl/XrdClDefaultEnv.hh/cc` | `src/connection/client.ts` | 默认 Client 实例 |
| `XrdCl/XrdClBuffer.hh` | 使用 `Uint8Array` | 无需实现 |
| `XrdCl/XrdClPropertyList.hh` | `Record<string, unknown>` | 无需实现 |
| `XrdCl/XrdClOptional.hh` | TypeScript `?` 语法 | 无需实现 |
| `XrdCl/XrdClPlugInInterface.hh` | ES Module interface | 无需实现 |

### 4.5 可以跳过的文件（P2-P3）

| C++ 文件 | 原因 |
|----------|------|
| `XrdCl/XrdClCopyProcess.hh/cc` | 复制过程管理，v1.5+ 再实现 |
| `XrdCl/XrdClClassicCopyJob.*` | 经典复制任务 |
| `XrdCl/XrdClThirdPartyCopyJob.*` | 第三方复制 |
| `XrdCl/XrdClEcHandler.*` | 纠删码处理器 |
| `XrdCl/XrdClZipArchive.*` | ZIP 支持 |
| `XrdCl/XrdClZipListHandler.*` | ZIP 列表 |
| `XrdCl/XrdClOperations.*` | 声明式操作框架 |
| `XrdCl/XrdClFileOperations.*` | 文件操作声明式封装 |
| `XrdCl/XrdClFileSystemOperations.*` | 文件系统操作声明式封装 |
| `XrdCl/XrdClParallelOperation.*` | 并行操作 |
| `XrdCl/XrdClMetalinkRedirector.*` | Metalink 重定向 |
| `XrdCl/XrdClRedirectorRegistry.*` | 重定向注册表 |
| `XrdCl/XrdClMonitor.*` | 监控接口 |
| `XrdCl/XrdClLocalFileHandler.*` | 本地文件处理 |
| `XrdCl/XrdClForkHandler.*` | fork 处理 |
| `XrdCl/XrdClFileTimer.*` | 定时器 |
| `XrdCl/XrdClCheckSumManager.*` | 校验和管理（内置简单实现） |
| `XrdCl/XrdClMessageUtils.*` | 消息工具 |
| `XrdCl/XrdClUtils.*` | 通用工具 |
| `XrdCl/XrdClPlugInManager.*` | 插件管理 |
| `XrdCl/XrdClAsyncHSReader/Writer.*` | 异步握手读写 |
| `XrdCl/XrdClAsyncMsgReader/Writer.*` | 异步消息读写 |
| `XrdCl/XrdClAsyncRawReader.*` | 异步原始读取 |
| `XrdCl/XrdClAsyncPageReader.*` | 异步页读取 |
| `XrdCl/XrdClAsyncVectorReader.*` | 异步向量读取 |
| `XrdCl/XrdClCopy.cc` | xrdcp 命令行工具 |
| `XrdCl/XrdClFS.cc` | xrdfs 命令行工具 |

---

## 五、第三方库替代清单

| C++ 模块 | TypeScript 替代 | 用途 |
|----------|----------------|------|
| `XrdSys` | Node.js 内置 | 线程、同步、日志 |
| `XrdNet` | `node:net` / `node:dns` | TCP 连接、DNS 解析 |
| `XrdTls` | `node:tls` | TLS/SSL 加密 |
| `XrdOuc` | 自实现（少量工具函数） | URL 解析、字符串处理 |
| `XrdXml` | `fast-xml-parser` | Metalink XML 解析 |
| `ZLIB` | `node:zlib` | 数据压缩 |
| `OpenSSL` | `node:crypto` | 加密、哈希 |
| `uuid` | `uuid` 包 | UUID 生成 |
| `XrdCrypto` | `node:crypto` | 证书处理（认证时用） |
| `XrdSec` | 自实现认证接口 | 认证框架 |

---

## 六、协议流程图

### 6.1 握手流程

```
Client                              Server
  │                                   │
  │  1. TCP Connect                   │
  │──────────────────────────────────>│
  │                                   │
  │  2. ClientHandShake (20 bytes)    │
  │     first=0, second=0             │
  │     third=0x00000520              │
  │     fourth=0, fifth=0             │
  │──────────────────────────────────>│
  │                                   │
  │  3. ServerHandShake (12 bytes)    │
  │     msglen, protover, msgval      │
  │<──────────────────────────────────│
  │                                   │
  │  4. Protocol Request              │
  │     (kXR_protocol, 3006)          │
  │──────────────────────────────────>│
  │                                   │
  │  5. Protocol Response             │
  │<──────────────────────────────────│
  │                                   │
  │  6. Login Request                 │
  │     (kXR_login, 3007)             │
  │     + pname[8] (服务器名)         │
  │──────────────────────────────────>│
  │                                   │
  │  7. Login Response                │
  │     + sessionid[16]               │
  │     + secToken (可选)             │
  │<──────────────────────────────────│
  │                                   │
  │  8. Auth Request (可选)           │
  │     (kXR_auth, 3000)              │
  │     + secProtocol + secToken      │
  │──────────────────────────────────>│
  │                                   │
  │  9. Auth Response                 │
  │<──────────────────────────────────│
  │                                   │
  │  === 连接就绪 ===                 │
```

### 6.2 文件读取流程

```
Client                              Server
  │                                   │
  │  Open Request (kXR_open)          │
  │  + path, flags, mode              │
  │──────────────────────────────────>│
  │  Open Response                    │
  │  + fhandle[4]                     │
  │<──────────────────────────────────│
  │                                   │
  │  Read Request (kXR_read)          │
  │  + fhandle, offset[8], dlen       │
  │──────────────────────────────────>│
  │  Read Response                    │
  │  + data[dlen]                     │
  │<──────────────────────────────────│
  │                                   │
  │  Close Request (kXR_close)        │
  │  + fhandle                        │
  │──────────────────────────────────>│
  │  Close Response                   │
  │<──────────────────────────────────│
```

### 6.3 重定向处理

```
Client                              Server A
  │                                   │
  │  Read Request                     │
  │──────────────────────────────────>│
  │                                   │
  │  Redirect Response                │
  │  + newhost, newport               │
  │<──────────────────────────────────│
  │                                   │
  │  (自动重连到 Server B)            │
  │  TCP Connect                      │
  │──────────────────────────────────>│  Server B
  │  HandShake + Login                │
  │──────────────────────────────────>│
  │  重新发送 Read Request            │
  │──────────────────────────────────>│
  │  Read Response                    │
  │<──────────────────────────────────│
```

---

## 七、模块划分

```
xrootd-client/
├── src/
│   ├── index.ts              # 公共 API 导出
│   ├── protocol/
│   │   ├── types.ts          # 基础类型（对应 XPtypes.hh）
│   │   ├── constants.ts      # 常量（请求码、响应码、错误码）
│   │   └── message.ts        # 消息编解码
│   ├── transport/
│   │   ├── transport.ts      # 传输层（TCP + TLS）
│   │   └── handshake.ts      # 握手状态机
│   ├── connection/
│   │   ├── client.ts         # 连接管理
│   │   └── session.ts        # Session 管理
│   ├── api/
│   │   ├── file.ts           # RootFile
│   │   ├── filesystem.ts     # RootFileSystem
│   │   ├── stream.ts         # ReadStream / WriteStream
│   │   ├── errors.ts         # XRootDError
│   │   └── types.ts          # 公共类型（StatInfo, LocationInfo 等）
│   └── auth/
│       ├── index.ts          # 认证接口
│       ├── host.ts           # host 认证
│       └── sss.ts            # sss 认证（可选）
├── package.json
└── tsconfig.json
```

---

## 八、关键设计决策

### 8.1 重定向处理

```typescript
// Transport 内部自动处理重定向
async sendRequest(requestId: RequestId, body: Uint8Array): Promise<Buffer> {
  const response = await this.sendRaw(requestId, body)
  const status = response.readInt16BE(0)

  if (status === ResponseStatus.Redirect) {
    // 解析重定向地址
    const newHost = response.subarray(20).toString().split('|')[0]
    // 重新连接
    await this.close()
    this.url = new URL(`root://${newHost}${this.url.pathname}`)
    await this.connect()
    // 重试请求
    return this.sendRaw(requestId, body)
  }

  if (status === ResponseStatus.Error) {
    const errCode = response.readInt16BE(20)
    throw new XRootDError(errCode, response.subarray(24).toString())
  }

  return response
}
```

### 8.2 错误类定义

```typescript
// src/api/errors.ts
export class XRootDError extends Error {
  constructor(
    public readonly code: number,      // kXR 错误码 (3000-3035)
    message?: string,
    public readonly errno?: number,    // POSIX errno
  ) {
    super(message ?? XRootDError.codeToMessage(code))
    this.name = 'XRootDError'
  }

  static codeToMessage(code: number): string {
    const messages: Record<number, string> = {
      300: 'Invalid arguments',
      301: 'File not found',
      302: 'Permission denied',
      303: 'No space left',
      304: 'Operation not supported',
      305: 'File already exists',
      306: 'Invalid checksum',
      307: 'File too large',
      308: 'Invalid link path',
      309: 'Not a directory',
      310: 'Directory not empty',
      311: 'Timed out',
      312: 'Too many links',
      313: 'Missing credential',
      314: 'Credential expired',
      315: 'No master server',
      // ...
    }
    return messages[code] ?? `XRootD error ${code}`
  }
}
```

### 8.3 并发请求与流复用

```typescript
// XRootD 协议支持在单个 TCP 连接上复用多个请求
// 通过 streamid 匹配请求和响应

export class Transport {
  private pending = new Map<number, {
    resolve: (data: Buffer) => void
    reject: (err: Error) => void
  }>()
  private streamId = 0

  async sendRequest(requestId: RequestId, body: Uint8Array): Promise<Buffer> {
    const sid = this.streamId++
    this.streamId &= 0xffff  // 16-bit wrap

    return new Promise((resolve, reject) => {
      this.pending.set(sid, { resolve, reject })

      // 发送请求...
      this.writeToSocket(requestId, sid, body)
    })
  }

  // 接收响应时，根据 streamid 匹配
  private onResponse(data: Buffer) {
    const sid = (data[0] << 8) | data[1]
    const status = data.readUInt16BE(2)
    const pending = this.pending.get(sid)
    if (pending) {
      this.pending.delete(sid)
      pending.resolve(data)
    }
  }
}

// 使用：多个请求可以并发发送
const [data1, data2] = await Promise.all([
  file1.read(0, 1024),
  file2.read(0, 2048),
])
```

### 8.4 错误处理：异常 vs Result

```typescript
// 方案 A：异常（推荐，符合 TypeScript 惯例）
try {
  await file.open(url)
} catch (e) {
  if (e instanceof XRootDError) { ... }
}

// 方案 B：Result 类型（可选，更函数式）
type Result<T, E = XRootDError> =
  | { ok: true; value: T }
  | { ok: false; error: E }

const result = await file.open(url)
if (result.ok) { ... } else { ... }
```

**建议：** 默认使用异常，提供 `safeXxx` 方法返回 Result。

### 8.5 连接池

```typescript
// 自动连接池（内置）
const client = new Client({
  maxConnections: 10,    // 每个 host 最大连接数
  keepAlive: true,       // 保持连接
  keepAliveTimeout: 30000,
})

// 或者手动管理
const transport = await client.getConnection('root://server')
```

### 8.6 超时控制

```typescript
// 方案 1：全局默认
const client = new Client({ timeout: 30000 })

// 方案 2：单次请求
await file.open(url, { timeout: 5000 })

// 方案 3：AbortSignal（推荐，可取消）
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)
await file.open(url, { signal: controller.signal })
```

---

## 九、总结

TypeScript 原生设计可以**大幅简化** C++ 原版的复杂度：

| 方面 | C++ 原版 | TypeScript 原生 |
|------|---------|----------------|
| **文件数** | 138 个 | ~20 个 |
| **代码量** | ~15,000 行 | ~3,000 行 |
| **异步模型** | 回调 + 状态机 | async/await |
| **错误处理** | 错误码检查 | 异常 / Result |
| **内存管理** | 手动 new/delete | 自动 GC |
| **类型安全** | 运行时检查 | 编译时类型检查 |
| **插件系统** | dlopen 共享库 | ES Module import |
| **流式 I/O** | 自定义缓冲区 | Node.js Stream |

核心协议逻辑（握手、编解码、认证流程）保持不变，但 API 表面完全按 TypeScript 习惯重新设计，保持结构简明性。
