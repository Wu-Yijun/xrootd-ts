# Test Fix Analysis

## 1-5. 已修复 (commits 30ec8f5, 93bd477, 4c726b6, c1776b9, 15e15a9)

---

## 6. src/api/file.test.ts 全部测试超时 - MockTransport.onData 未保存回调

**状态**: 已修复 (commit 039f581)

---

## 7. src/session/connect.test.ts - 测试全部超时

**问题类型**: 源码 bug

**问题描述**: `connectToHost` 中 Multiplexer 先于 FrameReader 注册 `onData` handler。handshake 过程中，Multiplexer 的 Framer 和 FrameReader 的 Framer 同时处理相同数据，Multiplexer 消费了 handshake 专用的帧（streamId=0），导致 FrameReader 永远等不到数据。

**源码分析**:
1. `connectToHost` (connect.ts:79) 创建 Multiplexer → 注册 `transport.onData(handler1)`
2. `handshake` (handshake.ts:71) 创建 FrameReader → 注册 `transport.onData(handler2)`
3. 服务器响应时，handler1 先执行，Multiplexer 的 Framer 解析帧
4. Multiplexer 找不到 pending request（handshake 阶段无请求），直接 return
5. handler2 执行，FrameReader 的 Framer 解析同一 chunk
6. 理论上应正常，但实测超时

**根本原因**: Multiplexer 构造时注册的 handler 与 FrameReader 注册的 handler 同时消费同一数据流，产生竞争条件。在 `connectToHost` 流程中，Multiplexer 不应在 handshake 完成前处理数据。

**修复方案**: 此为源码 bug，按规则标记为 skip，不修改源码。

**状态**: 待标记 skip
