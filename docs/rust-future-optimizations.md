# Rust 版未来优化方向

> TypeScript 版因复杂度/性能限制推迟的设计，供 Rust 实现时参考。
> 本文档为初版索引，后续随实现进展持续修正。

---

## 一、内存管理

### 零拷贝帧解析
TS 版 Framer 使用 `Buffer.concat` 每帧分配新内存。Rust 版使用 `bytes::BytesMut` + `Buf` trait 原地解析。

### 消息缓冲区池
TS 版每次请求 `Buffer.alloc(size)`。Rust 版使用 `tokio::sync::Semaphore` 或 slab allocator 复用缓冲区。

---

## 二、并发与连接

### 连接池 + kXR_bind 并行子流
TS 版单 TCP 连接存在队头阻塞。Rust 版通过 `kXR_bind` (3024) 建立并行子流，Router 按负载分发。
参考协议：`kXR_protocol(expect=kXR_ExpBind)` → `kXR_bind` 握手流程。

### 流式 I/O
TS 版 `read()` 返回完整 `Uint8Array`。Rust 版实现 `AsyncRead` trait，支持管道式流式处理。

---

## 三、容错

### 指数退避调度器
TS 版 `kXR_wait` 用简单 `setTimeout`。Rust 版实现 exponential backoff with jitter，按节点粒度管理。

### 透明句柄恢复
TS 版断线后用户需手动重连。Rust 版维护句柄表，自动重放 `kXR_open` 恢复 I/O。

---

## 四、传输层

### 多运行时 Transport
TS 版硬编码 `node:net`。Rust 版定义 `Transport` trait，支持 Tcp/Tls/QUICTransport。
