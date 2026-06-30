# XRootD TypeScript 客户端迁移工作计划

> 基于 `migration.md` 和 `typescript-design.md` 的架构设计，结合性能分析后的修正版实施计划。
> 核心原则：TypeScript 版快速跑通协议，高性能优化留给 Rust 版。

---

## 总览

| 阶段 | 内容 | 预估工时 | 依赖 |
|------|------|----------|------|
| **Phase 0** | 测试环境搭建 | 0.5 周 | — |
| **Phase 1** | 协议编解码 + 基础传输 | 2.5 周 | Phase 0 |
| **Phase 2** | 完整 API + 容错 | 2.5 周 | Phase 1 |
| **Phase 3** | 高级特性 | 2 周 | Phase 2 |
| **Phase 4** | 网格功能 | 2 周 | Phase 2 |
| **Phase 5** | 工程化 + 发布 | 1 周 | Phase 1-4 |
| **总计** | — | **10.5 周** | — |

> 注：Phase 3 和 Phase 4 可并行开发。Phase 1-2 完成即可覆盖 80% 日常使用场景。

---

## Phase 0：测试环境搭建（第 1 周前半）

**目标**：在写任何协议代码之前，先搭建可快速迭代的测试环境。

### 交付物

| 任务 | 说明 |
|------|------|
| Docker Mock Server | 使用 `alisw/xrootd` 镜像，配置无认证模式 |
| 配置挂载 | 支持自定义场景：重定向、kXR_wait 响应、慢速连接 |
| 验证脚本 | 用原版 `xrdfs` 客户端验证 Mock Server 可用 |

### 验收标准

- `docker compose up` 后 Mock Server 可接受 TCP 连接
- 原版客户端能完成 login → open → read → close 全流程

---

## Phase 1：协议编解码 + 基础传输（第 1-3 周）

**目标**：跑通无认证场景下的完整文件读取流程。

### 交付物

| 模块 | 文件 | 优先级 | 说明 |
|------|------|--------|------|
| 协议常量 | `src/protocol/constants.ts` | P0 | RequestId、ResponseStatus、ErrorCode 枚举 |
| 编解码工具 | `src/protocol/codec.ts` | P0 | 大端序读写工具函数 |
| 消息帧 | `src/protocol/message.ts` | P0 | Message 类（构建请求帧） |
| Transport 接口 | `src/transport/interface.ts` | P0 | ITransport 抽象接口 |
| Transport 实现 | `src/transport/transport.ts` | P0 | node:net/node:tls 封装 |
| 帧解析器 | `src/transport/framer.ts` | P0 | 粘包/半包处理，使用 Buffer.allocUnsafe |
| Framer 恶作剧 Server | `tests/helpers/tcp-chaos-server.ts` | P0 | 故意做 1-byte/随机切片的 TCP 测试服务器 |
| 多路复用器 | `src/transport/multiplexer.ts` | P0 | streamId 管理、kXR_wait 处理、全局超时扫描 |
| 握手状态机 | `src/session/handshake.ts` | P0 | kXR_protocol + kXR_login |
| 基础 File | `src/api/file.ts` | P0 | open/read/write/close |
| 错误类型 | `src/api/errors.ts` | P0 | XRootDError 类 |
| URL 解析 | `src/url/url.ts` | P0 | root:// 协议解析 |
| 类型定义 | `src/api/types.ts` | P1 | OpenFlags、StatInfo 等 |
| 测试 | `src/**/*.test.ts` | P0 | 单元测试 + Mock Server 集成测试 |

### 不包含

- Ring Buffer（记录在 `rust-future-optimizations.md`）
- 连接池/kXR_bind（记录在 `rust-future-optimizations.md`）
- TLS（移到 Phase 3）

### 验收标准

- 用 Mock Server 完成：login → open → read(offset, size) → close
- 所有 P0 请求码的编解码通过单元测试
- Framer 能够 100% 正确处理极端的 TCP 数据帧切片（1-byte 喂入、随机长度喂入）
- Multiplexer 正确处理 kXR_wait/kXR_waitresp 重试
- streamId 碰撞检测正常工作

---

## Phase 2：完整 API + 容错（第 4-6 周）

**目标**：覆盖完整的文件系统操作和错误处理。

### 交付物

| 模块 | 文件 | 优先级 | 说明 |
|------|------|--------|------|
| FileSystem | `src/api/filesystem.ts` | P1 | stat/readdir/mkdir/rmdir/rm/mv |
| 重定向处理 | `src/transport/multiplexer.ts` | P1 | 自动重连 + 重新握手 + 重发（限 16 次） |
| host 认证 | `src/security/host.ts` | P2 | 基于主机信任的兜底认证 |
| SSS 认证 | `src/security/sss.ts` | P2 | 共享密钥认证（Blowfish + CRC32） |
| 认证框架 | `src/session/auth.ts` | P2 | SecurityProtocol 接口 + 认证调度 |
| Sync/Truncate | `src/api/file.ts` | P1 | sync()、truncate() 方法 |
| StatInfo 类型 | `src/api/types.ts` | P1 | 完整的 StatInfo 接口 |
| 集成测试 | `tests/` | P1 | 端到端测试覆盖 |

### 不包含

- 句柄自动恢复（记录在 `rust-future-optimizations.md`，由应用层处理）
- 完整时间轮（sweepTimeouts 已足够）

### 验收标准

- 完整的目录操作：mkdir → readdir → rename → rmdir
- 重定向场景下自动重连成功
- SSS 认证握手通过 Mock Server 验证
- 断线后 pending 请求正确 reject（错误码 ClientError.Disconnected）

---

## Phase 3：高级特性（第 7-8 周）

**目标**：TLS、流式接口、向量 I/O、Token 认证。

### 交付物

| 模块 | 说明 | 优先级 |
|------|------|--------|
| TLS 支持 | Transport 层 TLS 升级（kXR_wantTLS 协商） | P1 |
| SciTokens 认证 | JWT/SciTokens 认证（WLCG 现代安全框架） | P2 |
| 流式接口 | File.createReadStream() 返回 Readable | P2 |
| 向量 I/O | vectorRead/vectorWrite 基础实现 | P2 |
| 查询/统计 | FileSystem.query()、ping() | P2 |
| 扩展属性 | setXAttr/getXAttr/delXAttr/listXAttr | P2 |

### 不包含

- SIMD 优化（Rust 版方向）
- ReadableStream（Web Streams API，可选增强）

### 验收标准

- TLS 连接到 Mock Server（配置 TLS 后）
- SciTokens 认证握手通过 Mock Server 验证
- 流式读取 10MB 文件无内存溢出
- kXR_readv 批量读取多个 chunk 正确返回

---

## Phase 4：网格功能（第 9-10 周）

**目标**：复制引擎、第三方拷贝、异步通知。

### 交付物

| 模块 | 说明 | 优先级 |
|------|------|--------|
| CopyProcess | 复制引擎基础实现 | P2 |
| 第三方拷贝 | kXR_prepare + 服务端直传 | P2 |
| kXR_attn 处理 | 异步事件回调（简单回调，不做 AsyncGenerator） | P2 |
| 文件校验 | kXR_query 的 kXR_Qcksum 功能 | P2 |
| 页读写 | pgRead/pgWrite + CRC32C 校验 | P2 |

### 不包含

- Metalink 智能路由（标记为可选）
- 纠删码（XrdEc，标记为可选）

### 验收标准

- CopyProcess 完成跨节点文件复制
- kXR_attn 事件正确触发回调
- pgRead 返回数据 + CRC32C 校验值

---

## Phase 5：工程化 + 发布（第 11 周）

**目标**：CI、文档、发布。

### 交付物

| 任务 | 说明 |
|------|------|
| CI 流程 | GitHub Actions：Node.js 22+ 构建、类型检查、测试 |
| API 文稿 | 基于 TSDoc 生成 API 文档 |
| README 完善 | 使用示例、API 概览、迁移指南 |
| npm 发布 | 配置 publishConfig，发布 @xrootd/client |

---

## 关键设计决策记录

以下特性已明确**不在 TypeScript 版实现**，记录在 `rust-future-optimizations.md`：

| 特性 | 原因 | Rust 方案 |
|------|------|-----------|
| Ring Buffer Framer | TS 中回绕处理复杂度高，收益有限 | bytes::BytesMut |
| 连接池 + kXR_bind | TS 单线程模型下收益有限 | tokio 并行子流 |
| 透明句柄恢复 | 实现难度大，应用层责任更合理 | 自动重放 kXR_open |
| 指数退避调度器 | sweepTimeouts 已足够 v1 | exponential backoff with jitter |
| 流式 AsyncRead | v1 返回 Uint8Array 足够 | tokio::io::AsyncRead |
| SIMD 向量 I/O | 客户端库不应承担计算层职责 | 直接写入 WASM 内存 |

---

## 风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Mock Server 不稳定 | 阻塞集成测试 | 使用官方镜像 + 固定版本标签 |
| kXR_wait 场景难复现 | 重试逻辑无法验证 | 1) 单元测试：mock ITransport 注入伪造 Frame；2) 集成测试：本地 TCP 代理拦截器注入 4005 帧 |
| TLS 协商复杂 | Phase 3 延期 | 先实现非 TLS 路径，TLS 作为可选增强 |
| 认证协议依赖 | SSS 需要 Blowfish 实现 | 使用 node:crypto 的 bf-ecb 支持 |
| SciTokens 服务器支持不普遍 | 部分节点未启用 SciTokens | SSS/host 作为兜底，SciTokens 为可选增强 |
