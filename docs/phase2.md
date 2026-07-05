# Phase 2：完整 API + 容错

**目标**：覆盖完整的文件系统操作和错误处理，实现重定向自动恢复和基础认证框架  
**工期**：2.5 周（~12 工作日）  
**当前状态**：Phase 1 已完成（协议编解码、基础传输、握手、File 基础操作）

---

## 总览

| 模块 | 内容 | 工时 | 依赖 |
|------|------|------|------|
| 模块一 | 协议扩展 — 新增请求帧构建器 | 1d | Phase 1 模块一 |
| 模块二 | 重定向自动处理 | 1.5d | Phase 1 模块五、模块六 |
| 模块三 | FileSystem 类 | 2d | 模块一、Phase 1 模块五 |
| 模块四 | File 扩展 — sync/truncate | 0.5d | 模块一、Phase 1 模块七 |
| 模块五 | 认证框架 | 2d | Phase 1 模块六 |
| 模块六 | host 认证 | 0.5d | 模块五 |
| 模块七 | SSS 认证 | 2d | 模块五 |
| 模块八 | 类型定义完善 | 1d | — |
| 模块九 | 端到端集成测试 | 1.5d | 所有模块 |

---

## 模块一：协议扩展 — 新增请求帧构建器（Day 1）

依赖 Phase 1 模块一（constants.ts、codec.ts）。

### 1.1 新增请求帧构建函数

**文件**：`src/protocol/message.ts` 扩展

**产出**：

```typescript
// kXR_sync 请求
export function buildSyncRequest(
  streamId: number,
  fhandle: Uint8Array
): Buffer

// kXR_truncate 请求
export function buildTruncateRequest(
  streamId: number,
  fhandle: Uint8Array,
  size: number
): Buffer

// kXR_dirlist 请求
export function buildDirlistRequest(
  streamId: number,
  path: string,
  options?: number
): Buffer

// kXR_mkdir 请求
export function buildMkdirRequest(
  streamId: number,
  path: string,
  mode?: number
): Buffer

// kXR_rmdir 请求
export function buildRmdirRequest(
  streamId: number,
  path: string
): Buffer

// kXR_rm 请求
export function buildRmRequest(
  streamId: number,
  path: string
): Buffer

// kXR_mv 请求
export function buildMvRequest(
  streamId: number,
  source: string,
  target: string
): Buffer

// kXR_auth 请求
export function buildAuthRequest(
  streamId: number,
  credType: number,
  credData: Uint8Array
): Buffer

// kXR_endsess 请求
export function buildEndsessRequest(
  streamId: number,
  sessid: Uint8Array
): Buffer
```

**协议细节**：

| 请求 | 帧结构 | 说明 |
|------|--------|------|
| `kXR_sync` | `streamid[2] + requestid(3016) + fhandle[4] + reserved[12] + dlen(4)` | dlen=0 |
| `kXR_truncate` | `streamid[2] + requestid(3028) + fhandle[4] + reserved[12] + dlen(4) + size[8]` | size 为 64-bit 大端序 |
| `kXR_dirlist` | `streamid[2] + requestid(3004) + reserved[15] + options[1] + dlen(4) + path` | options: kXR_online=1, kXR_dstat=2 |
| `kXR_mkdir` | `streamid[2] + requestid(3008) + mode[2] + reserved[14] + dlen(4) + path` | mode 默认 0o755 |
| `kXR_rmdir` | `streamid[2] + requestid(3015) + reserved[16] + dlen(4) + path` | — |
| `kXR_rm` | `streamid[2] + requestid(3014) + reserved[16] + dlen(4) + path` | — |
| `kXR_mv` | `streamid[2] + requestid(3009) + reserved[14] + arg1len(2) + dlen(4) + source + target` | arg1len=source.length |
| `kXR_auth` | `streamid[2] + requestid(3000) + reserved[12] + credtype[4] + dlen(4) + credData` | — |
| `kXR_endsess` | `streamid[2] + requestid(3023) + sessid[16] + dlen(4)` | dlen=0 |

### 1.2 响应帧解析函数

**文件**：`src/protocol/message.ts` 扩展

**产出**：

```typescript
export interface DirlistResponse {
  entries: DirectoryEntry[]
}

export interface DirectoryEntry {
  name: string
  size: number
  flags: number
  modTime: number
}

export function parseDirlistResponse(body: Buffer): DirlistResponse
```

**dirlist 响应格式**：
- 每个条目格式：`name\0size:flags:mtime\n`
- 以 `\0` 分隔多个条目
- 最后一个条目后无 `\0`

**工时**：6h

---

### 验收

- `src/protocol/message.test.ts` 新增用例通过：验证各请求帧的字节布局
- 验证 `parseDirlistResponse` 正确解析目录列表

---

## 模块二：重定向自动处理（Day 2-3）

依赖 Phase 1 模块五（Multiplexer）、模块六（handshake）。

### 2.1 重定向处理逻辑

**文件**：`src/transport/multiplexer.ts` 扩展

**需求**：在 Multiplexer 的 `handleFrame()` 中拦截 `ResponseStatus.Redirect` (4004) 帧，触发自动重连流程。

**协议流程**：
```
客户端                                      服务器 A
  |  Read Request                             |
  |─────────────────────────────────────────>|
  |                                           |
  |  Redirect Response                        |
  |  + port(4B) + host(variable)              |
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

**实现方案**：

```typescript
// Multiplexer 新增配置
interface MultiplexerOptions {
  maxRedirects?: number     // 默认 16
  onRedirect?: (host: string, port: number) => void
  onReconnect?: () => Promise<Session>
}

// handleFrame() 中新增 Redirect 处理
if (frame.status === ResponseStatus.Redirect) {
  const { host, port } = parseRedirectResponse(frame.body)

  if (this.redirectCount >= this.maxRedirects) {
    pending.reject(new XRootDError(
      ClientError.TooManyRedirs,
      `Too many redirects (max ${this.maxRedirects})`
    ))
    return
  }

  this.redirectCount++
  // 断开当前连接
  await this.transport.close()
  // 重新连接
  await this.transport.connect(host, port)
  // 重新握手（由外部注入的 onReconnect 回调处理）
  const newSession = await this.onReconnect()
  // 重发请求
  this.retryRequest(sid)
}
```

### 2.2 Client 集成

**文件**：`src/client.ts` 扩展

**修改**：
- `XRootDClient` 持有 `Multiplexer` 实例
- 注入 `onReconnect` 回调，实现握手 + 重登录
- 追踪当前连接的 host/port

```typescript
export class XRootDClient {
  private mux: Multiplexer
  private session: Session | null = null
  private currentHost: string
  private currentPort: number

  async connect(url: string | XRootDUrl): Promise<void> {
    const parsed = typeof url === 'string' ? new XRootDUrl(url) : url
    this.currentHost = parsed.host
    this.currentPort = parsed.port

    const transport = new Transport()
    await transport.connect(parsed.host, parsed.port)
    this.mux = new Multiplexer(transport, {
      maxRedirects: 16,
      onReconnect: () => this.reconnect(),
    })
    this.session = await handshake(this.mux, parsed, {
      username: this.options.credentials?.username,
    })
  }

  private async reconnect(): Promise<Session> {
    // 发送 kXR_endsess 结束旧会话（如果有）
    if (this.session) {
      try {
        const endsessBody = new Uint8Array(16)
        endsessBody.set(this.session.sessid)
        await this.mux.request(RequestId.Endsess, endsessBody)
      } catch {
        // 忽略 endsess 错误（旧会话可能已过期）
      }
    }
    // 重新握手 + 登录
    this.session = await handshake(this.mux, /* current url */, {
      username: this.options.credentials?.username,
    })
    return this.session
  }
}
```

### 2.3 断线处理

**逻辑**：
- Transport `onClose` 事件 → reject 所有 pending 请求，错误码 `ClientError.Disconnected`
- File 类检测到 `Disconnected` 错误时，将 `fhandle` 置为 `null`

```typescript
// Multiplexer.close() 扩展
transport.onClose(() => {
  for (const [sid, req] of this.pending) {
    req.reject(new XRootDError(
      ClientError.Disconnected,
      'Connection closed'
    ))
  }
  this.pending.clear()
})
```

### 2.4 测试

**文件**：`tests/e2e/redirect.test.ts` 扩展

**测试场景**：
1. 服务器 A 返回 Redirect → 自动重连到服务器 B → 重发请求成功
2. 超过最大重定向次数 → reject TooManyRedirs
3. 重定向后服务器 B 不可达 → reject 连接错误
4. 断线后 pending 请求 → reject Disconnected
5. 断线后 File 操作 → fhandle 置 null

**工时**：12h

---

### 验收

- 重定向场景下自动重连成功
- 断线后 pending 请求正确 reject（错误码 ClientError.Disconnected）
- 超过最大重定向次数时正确 reject
- `tests/e2e/redirect.test.ts` 全部通过

---

## 模块三：FileSystem 类（Day 4-5）

依赖模块一、Phase 1 模块五（Multiplexer）。

### 3.1 FileSystem 核心实现

**文件**：`src/api/filesystem.ts`

**产出**：

```typescript
import { Multiplexer } from '../transport/multiplexer.js'
import { XRootDUrl } from '../url/url.js'
import {
  buildStatRequest,
  buildDirlistRequest,
  buildMkdirRequest,
  buildRmdirRequest,
  buildRmRequest,
  buildMvRequest,
  parseDirlistResponse,
} from '../protocol/message.js'
import { RequestId, ResponseStatus } from '../protocol/constants.js'
import { XRootDError } from './errors.js'
import type { StatInfo, DirectoryList } from './types.js'

export class FileSystem {
  private mux: Multiplexer
  private url: XRootDUrl

  constructor(mux: Multiplexer, url: XRootDUrl)

  /** 获取文件/目录状态 */
  async stat(path: string, infoType?: number): Promise<StatInfo>

  /** 列出目录内容 */
  async readdir(path: string, options?: {
    online?: boolean
    stat?: boolean
  }): Promise<DirectoryList>

  /** 创建目录 */
  async mkdir(path: string, mode?: number): Promise<void>

  /** 删除目录 */
  async rmdir(path: string): Promise<void>

  /** 删除文件 */
  async rm(path: string): Promise<void>

  /** 移动/重命名文件或目录 */
  async mv(source: string, target: string): Promise<void>
}
```

### 3.2 各方法实现细节

#### stat

```typescript
async stat(path: string, infoType?: number): Promise<StatInfo> {
  const body = buildStatRequest(0, path)
  const frame = await this.mux.request(RequestId.Stat, body)

  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum, errmsg)
  }

  // 解析文本格式的 stat 响应
  // 格式："id size mtime flags"（空格分隔）
  return this.parseStatResponse(frame.body)
}
```

#### readdir

```typescript
async readdir(path: string, options?: {
  online?: boolean
  stat?: boolean
}): Promise<DirectoryList> {
  let opts = 0
  if (options?.online) opts |= 1  // kXR_online
  if (options?.stat) opts |= 2    // kXR_dstat

  const body = buildDirlistRequest(0, path, opts)
  const frame = await this.mux.request(RequestId.Dirlist, body)

  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum, errmsg)
  }

  // 可能需要多次读取（kXR_oksofar）
  const entries: DirectoryEntry[] = []
  let currentFrame = frame

  while (currentFrame.status === ResponseStatus.Oksofar) {
    entries.push(...parseDirlistResponse(currentFrame.body).entries)
    // 等待下一个数据帧
    currentFrame = await this.mux.waitForNextFrame(currentFrame.streamId)
  }
  entries.push(...parseDirlistResponse(currentFrame.body).entries)

  return { name: path, entries }
}
```

#### mkdir / rmdir / rm / mv

```typescript
async mkdir(path: string, mode = 0o755): Promise<void> {
  const body = buildMkdirRequest(0, path, mode)
  const frame = await this.mux.request(RequestId.Mkdir, body)
  this.handleResponse(frame)
}

async rmdir(path: string): Promise<void> {
  const body = buildRmdirRequest(0, path)
  const frame = await this.mux.request(RequestId.Rmdir, body)
  this.handleResponse(frame)
}

async rm(path: string): Promise<void> {
  const body = buildRmRequest(0, path)
  const frame = await this.mux.request(RequestId.Rm, body)
  this.handleResponse(frame)
}

async mv(source: string, target: string): Promise<void> {
  const body = buildMvRequest(0, source, target)
  const frame = await this.mux.request(RequestId.Mv, body)
  this.handleResponse(frame)
}

private handleResponse(frame: Frame): void {
  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum, errmsg)
  }
}
```

### 3.3 FileSystem 测试

**文件**：`src/api/filesystem.test.ts`

**测试场景**：
1. stat 文件 → 返回正确的 StatInfo
2. stat 不存在的文件 → throw XRootDError(NotFound)
3. readdir 目录 → 返回目录列表
4. mkdir → rmdir 完整流程
5. rm 文件
6. mv 文件 → 验证重命名成功
7. rmdir 非空目录 → throw XRootDError
8. mkdir 已存在的目录 → throw XRootDError

**工时**：16h

---

### 验收

- 完整的目录操作：mkdir → readdir → rename → rmdir
- `src/api/filesystem.test.ts` 全部通过

---

## 模块四：File 扩展 — sync/truncate（Day 5 半天）

依赖模块一、Phase 1 模块七（File）。

### 4.1 sync 方法

**文件**：`src/api/file.ts` 扩展

```typescript
async sync(): Promise<void> {
  if (!this._isOpen || !this.fhandle) {
    throw new Error('File is not open')
  }

  const body = buildSyncRequest(0, this.fhandle)
  const frame = await this.mux.request(RequestId.Sync, body)

  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum, errmsg)
  }
}
```

### 4.2 truncate 方法

```typescript
async truncate(size: number): Promise<void> {
  if (!this._isOpen || !this.fhandle) {
    throw new Error('File is not open')
  }

  const body = buildTruncateRequest(0, this.fhandle, size)
  const frame = await this.mux.request(RequestId.Truncate, body)

  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum, errmsg)
  }
}
```

### 4.3 测试

**文件**：`src/api/file.test.ts` 扩展

**测试场景**：
1. sync 未 open 的文件 → throw Error
2. truncate 未 open 的文件 → throw Error
3. sync 已打开的文件 → 成功
4. truncate 到指定大小 → 成功

**工时**：4h

---

### 验收

- sync() 和 truncate() 方法正常工作
- `src/api/file.test.ts` 新增用例通过

---

## 模块五：认证框架（Day 6-7）

依赖 Phase 1 模块六（handshake）。

### 5.1 SecurityProtocol 接口

**文件**：`src/security/interface.ts`

**产出**：

```typescript
/** 安全协议抽象接口 */
export interface SecurityProtocol {
  /** 协议名称（如 "host", "sss", "krb5"） */
  readonly name: string

  /** 生成客户端凭据发送给服务器 */
  getCredentials(params?: AuthParams): Promise<Uint8Array>

  /** 处理服务器的认证挑战（kXR_authmore 响应） */
  processChallenge(challenge: Uint8Array): Promise<Uint8Array>

  /** 认证是否完成 */
  isComplete(): boolean

  /** 获取认证后的实体信息 */
  getEntity(): SecEntity
}

/** 认证参数 */
export interface AuthParams {
  host: string
  port: number
  username?: string
  password?: string
  sessid: Uint8Array
}

/** 认证实体 */
export interface SecEntity {
  prot: string       // 认证协议名
  name?: string      // 实体名（用户名）
  host?: string      // 主机名
  uid: number        // Unix UID
  gid: number        // Unix GID
}
```

### 5.2 认证调度器

**文件**：`src/session/auth.ts`

**产出**：

```typescript
import type { SecurityProtocol } from '../security/interface.js'
import type { Multiplexer } from '../transport/multiplexer.js'
import { RequestId, ResponseStatus } from '../protocol/constants.js'
import { buildAuthRequest } from '../protocol/message.js'
import { XRootDError } from '../api/errors.js'

/** 认证协议注册表 */
const authProtocols = new Map<string, () => SecurityProtocol>()

/** 注册认证协议 */
export function registerAuthProtocol(
  name: string,
  factory: () => SecurityProtocol
): void {
  authProtocols.set(name, factory)
}

/** 根据服务器 secReqs 选择并执行认证 */
export async function doAuthentication(
  mux: Multiplexer,
  secReqs: string,
  params: AuthParams
): Promise<SecEntity> {
  // 解析服务器支持的协议列表
  const supportedProtocols = secReqs.split(',')

  // 按优先级选择协议
  for (const protoName of supportedProtocols) {
    const factory = authProtocols.get(protoName)
    if (!factory) continue

    const protocol = factory()
    return await executeAuth(mux, protocol, params)
  }

  throw new XRootDError(
    3030, // AuthFailed
    `No supported authentication protocol. Server requires: ${secReqs}`
  )
}

async function executeAuth(
  mux: Multiplexer,
  protocol: SecurityProtocol,
  params: AuthParams
): Promise<SecEntity> {
  // 发送初始凭据
  const creds = await protocol.getCredentials(params)
  let frame = await mux.request(
    RequestId.Auth,
    buildAuthRequest(0, getCredType(protocol.name), creds)
  )

  // 处理 kXR_authmore 循环
  while (frame.status === ResponseStatus.Authmore) {
    const challenge = frame.body
    const response = await protocol.processChallenge(challenge)
    frame = await mux.request(
      RequestId.Auth,
      buildAuthRequest(0, getCredType(protocol.name), response)
    )
  }

  if (frame.status !== ResponseStatus.Ok) {
    throw new XRootDError(3030, `Authentication failed with protocol: ${protocol.name}`)
  }

  return protocol.getEntity()
}

function getCredType(name: string): number {
  // 凭证类型映射
  switch (name) {
    case 'host': return 0
    case 'sss': return 1
    case 'unix': return 2
    case 'krb5': return 3
    case 'gsi': return 4
    default: throw new Error(`Unknown auth protocol: ${name}`)
  }
}
```

### 5.3 握手流程集成

**文件**：`src/session/handshake.ts` 修改

**修改点**：
- 握手完成后，若 `session.needsAuth` 为 true，调用 `doAuthentication()`
- 将 `secReqs` 传递给认证调度器

```typescript
export async function handshake(
  mux: Multiplexer,
  url: XRootDUrl,
  options?: {
    username?: string
    pid?: number
  }
): Promise<Session> {
  // ... 现有握手流程 ...

  // 若需要认证
  if (loginResponse.needsAuth && session.secReqs) {
    const entity = await doAuthentication(mux, session.secReqs, {
      host: url.host,
      port: url.port,
      username: options?.username,
      sessid: session.sessid,
    })
    session.entity = entity
  }

  return session
}
```

### 5.4 认证框架测试

**文件**：`src/session/auth.test.ts`

**测试场景**：
1. 无需认证（secReqs 为空）→ 跳过认证
2. 单协议认证 → 成功
3. 多协议回退 → 选择第一个支持的协议
4. 认证失败 → throw AuthFailed
5. kXR_authmore 多轮交互 → 成功
6. 无支持的协议 → throw AuthFailed

**工时**：16h

---

### 验收

- 认证框架可扩展，支持注册多种协议
- 握手流程自动处理认证
- `src/session/auth.test.ts` 全部通过

---

## 模块六：host 认证（Day 8 半天）

依赖模块五。

### 6.1 host 认证实现

**文件**：`src/security/host.ts`

**产出**：

```typescript
import type { SecurityProtocol, AuthParams, SecEntity } from './interface.js'

/**
 * host 认证：基于主机信任的兜底认证
 *
 * 凭据格式：主机名（无密码）
 * 服务器验证客户端 IP 是否在信任列表中
 */
export class HostAuth implements SecurityProtocol {
  readonly name = 'host'
  private entity: SecEntity = { prot: 'host', uid: 0, gid: 0 }
  private complete = false

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    // 发送主机名作为凭据
    const hostname = params.host || 'unknown'
    const encoder = new TextEncoder()
    return encoder.encode(hostname)
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    // host 认证不需要挑战-响应
    this.complete = true
    return new Uint8Array(0)
  }

  isComplete(): boolean {
    return this.complete
  }

  getEntity(): SecEntity {
    return this.entity
  }
}

/** 注册 host 认证协议 */
export function registerHostAuth(): void {
  // 在 auth.ts 中注册
  const { registerAuthProtocol } = require('../session/auth.js')
  registerAuthProtocol('host', () => new HostAuth())
}
```

### 6.2 测试

**文件**：`src/security/host.test.ts`

**测试场景**：
1. getCredentials 返回主机名
2. processChallenge 标记完成
3. isComplete 正确追踪状态
4. getEntity 返回正确实体

**工时**：4h

---

### 验收

- host 认证协议实现正确
- `src/security/host.test.ts` 通过

---

## 模块七：SSS 认证（Day 8-9）

依赖模块五。

### 7.1 SSS 认证实现

**文件**：`src/security/sss.ts`

**产出**：

```typescript
import { createCipheriv } from 'node:crypto'
import type { SecurityProtocol, AuthParams, SecEntity } from './interface.js'

/**
 * SSS（Simple Shared Secret）认证
 *
 * 使用 Blowfish-ECB 加密 + CRC32 校验
 * 凭据格式：加密后的（密码 + CRC32 校验）
 */
export class SSSAuth implements SecurityProtocol {
  readonly name = 'sss'
  private entity: SecEntity = { prot: 'sss', uid: 0, gid: 0 }
  private complete = false
  private key: Buffer

  constructor(key: Buffer) {
    // SSS 密钥为 8 字节（Blowfish 块大小）
    if (key.length !== 8) {
      throw new Error('SSS key must be 8 bytes')
    }
    this.key = key
  }

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    const password = params.password || ''
    const encoder = new TextEncoder()
    const passwordBytes = encoder.encode(password)

    // 计算 CRC32 校验
    const crc = this.crc32(passwordBytes)

    // 拼接密码 + CRC32
    const payload = Buffer.alloc(passwordBytes.length + 4)
    Buffer.from(passwordBytes).copy(payload, 0)
    payload.writeUInt32BE(crc, passwordBytes.length)

    // Blowfish-ECB 加密
    const encrypted = this.encrypt(payload)

    this.entity.name = params.username
    return encrypted
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    // SSS 认证为单轮
    this.complete = true
    return new Uint8Array(0)
  }

  isComplete(): boolean {
    return this.complete
  }

  getEntity(): SecEntity {
    return this.entity
  }

  private encrypt(data: Buffer): Buffer {
    // Blowfish-ECB，8 字节块对齐
    const cipher = createCipheriv('bf-ecb', this.key, null)
    // ECB 模式需要填充到 8 字节倍数
    const padded = this.pkcs5Pad(data, 8)
    return Buffer.concat([cipher.update(padded), cipher.final()])
  }

  private pkcs5Pad(data: Buffer, blockSize: number): Buffer {
    const padLen = blockSize - (data.length % blockSize)
    const padded = Buffer.alloc(data.length + padLen)
    data.copy(padded)
    padded.fill(padLen, data.length)
    return padded
  }

  private crc32(data: Uint8Array): number {
    // CRC32 实现（IEEE 802.3）
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
    }
    return (crc ^ 0xffffffff) >>> 0
  }
}
```

### 7.2 CRC32 工具函数

**文件**：`src/utils/crc32.ts`

```typescript
/**
 * CRC32（IEEE 802.3）实现
 * 用于 SSS 认证的校验计算
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
```

### 7.3 测试

**文件**：`src/security/sss.test.ts`

**测试场景**：
1. 构造函数验证密钥长度
2. getCredentials 返回加密数据
3. CRC32 计算正确性
4. Blowfish 加密块对齐
5. processChallenge 标记完成
6. 错误密钥长度 → throw

**工时**：16h

---

### 验收

- SSS 认证握手通过 Mock Server 验证
- Blowfish 加密 + CRC32 校验正确
- `src/security/sss.test.ts` 全部通过

---

## 模块八：类型定义完善（Day 10）

无依赖，可并行开发。

### 8.1 完善 StatInfo

**文件**：`src/api/types.ts` 扩展

```typescript
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

// StatInfo 工厂函数（解析文本格式响应）
export function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/)
  const id = parseInt(parts[0], 10)
  const size = parseInt(parts[1], 10)
  const mtime = parseInt(parts[2], 10)
  const flags = parseInt(parts[3], 10)

  return {
    id,
    size,
    mtime,
    flags,
    get isDirectory() { return (flags & 0x1000) !== 0 },
    get isLink() { return (flags & 0x2000) !== 0 },
    get isOffline() { return (flags & 0x4000) !== 0 },
    get isCached() { return (flags & 0x8000) !== 0 },
  }
}
```

### 8.2 目录列表类型

```typescript
export interface DirectoryEntry {
  name: string
  size: number
  flags: number
  modTime: number
}

export interface DirectoryList {
  name: string
  entries: DirectoryEntry[]
}

export interface OpenOptions {
  flags?: OpenFlags
  mode?: number
  signal?: AbortSignal
}
```

### 8.3 认证相关类型

```typescript
export interface AuthConfig {
  username?: string
  password?: string
  protocol?: string    // 指定认证协议
}

export interface ClientOptions {
  credentials?: AuthConfig
  timeout?: number
  maxRedirects?: number
}
```

**工时**：8h

---

### 验收

- 类型定义完整覆盖所有 API
- `npm run typecheck` 通过

---

## 模块九：端到端集成测试（Day 11-12）

依赖所有模块。

### 9.1 目录操作 E2E 测试

**文件**：`tests/e2e/filesystem.test.ts`

**测试流程**：
1. 连接到 Mock Server
2. 执行握手（无认证）
3. mkdir → readdir → rename → rmdir 完整流程
4. stat 文件验证元数据
5. rm 文件

### 9.2 重定向 E2E 测试

**文件**：`tests/e2e/redirect.test.ts` 扩展

**测试流程**：
1. 连接到 Mock Server A
2. 发送请求
3. 收到 kXR_redirect 响应
4. 自动重连到 Mock Server B
5. 重新执行握手 + 登录
6. 重发请求
7. 验证响应

### 9.3 SSS 认证 E2E 测试

**文件**：`tests/e2e/auth.test.ts`

**测试流程**：
1. 连接到配置了 SSS 认证的 Mock Server
2. 执行握手
3. 服务器返回 secReqs="sss"
4. 客户端自动选择 SSS 认证
5. 发送加密凭据
6. 服务器验证通过
7. 认证完成，会话建立

### 9.4 错误处理 E2E 测试

**文件**：`tests/e2e/error.test.ts` 扩展

**测试场景**：
1. kXR_error → throw XRootDError（各错误码）
2. 连接断开 → reject Disconnected
3. 超时 → reject timeout
4. 文件不存在 → throw NotFound
5. 权限不足 → throw NotAuthorized
6. 目录不存在 → throw NotFound
7. 重命名冲突 → throw ItExists

**工时**：12h

---

### 验收

- 完整的目录操作：mkdir → readdir → rename → rmdir
- 重定向场景下自动重连成功
- SSS 认证握手通过 Mock Server 验证
- 断线后 pending 请求正确 reject（错误码 ClientError.Disconnected）
- `npm test` 全部通过
- `npm run typecheck` 通过

---

## 依赖关系图

```
Phase 1 (已完成)
  │
  ├──→ 模块一 (协议扩展) ──┬──→ 模块三 (FileSystem) ──┐
  │                        ├──→ 模块四 (File sync/trunc) ─┤
  │                        │                              │
  ├──→ 模块二 (重定向处理) ──┘                              │
  │                                                        │
  ├──→ 模块五 (认证框架) ──┬──→ 模块六 (host 认证) ──────┤
  │                       ├──→ 模块七 (SSS 认证) ────────┤
  │                       │                              │
  ├──→ 模块八 (类型定义) ──┘                              │
  │                                                      │
  └──────────────────────────────────────────────────────┘
                                                       │
                                              模块九 (E2E 测试)
```

---

## 关键路径

**模块一 → 模块三 → 模块九**

总工时约 **12 天**，关键路径上的阻塞风险：

1. **重定向处理**：需要修改 Multiplexer 核心逻辑，影响面广
2. **dirlist 多帧响应**：需要处理 kXR_oksofar 状态的多帧数据
3. **SSS Blowfish 加密**：node:crypto 的 bf-ecb 支持需要验证

---

## 不包含

- 句柄自动恢复（记录在 `rust-future-optimizations.md`，由应用层处理）
- 完整时间轮（sweepTimeouts 已足够）
- TLS 协商（移到 Phase 3）
- 向量 I/O（移到 Phase 3）
- 扩展属性（移到 Phase 3）

---

## 验收标准

- [ ] 完整的目录操作：mkdir → readdir → rename → rmdir
- [ ] 重定向场景下自动重连成功
- [ ] SSS 认证握手通过 Mock Server 验证
- [ ] 断线后 pending 请求正确 reject（错误码 ClientError.Disconnected）
- [ ] 所有 P1 请求码的编解码通过单元测试
- [ ] `npm test` 全部通过
- [ ] `npm run typecheck` 通过
