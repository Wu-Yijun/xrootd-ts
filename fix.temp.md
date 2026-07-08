# Test Fix Analysis

## 1. src/protocol/message.test.ts:491-504 - buildMkdirRequest mode offset 错误

**问题类型**: 测试文件断言错误

**修复方案**: 将 `readUInt16BE(17)` 改为 `readUInt16BE(18)`。

**状态**: 已修复 (commit 30ec8f5)

---

## 2. src/transport/framer.test.ts:179-203 - streamId 类型断言错误

**问题类型**: 测试文件断言错误

**修复方案**: 使用 `readUInt16BE(0)` 从 Buffer 中读取数值。

**状态**: 已修复 (commit 93bd477)

---

## 3. src/transport/multiplexer.test.ts:309-344 - redirectCount 初始化测试缺少 onRedirect

**问题类型**: 测试文件遗漏步骤

**修复方案**: 在 Multiplexer 构造选项中添加带重试逻辑的 `onRedirect` 函数。

**状态**: 已修复 (commit 4c726b6)

---

## 4. src/security/host.test.ts:19-31 - getCredentials 断言错误

**问题类型**: 测试文件断言错误（测试内部自相矛盾）

**修复方案**: 将断言改为验证实际返回值 `"host\0"`。

**状态**: 已修复 (commit c1776b9)

---

## 5. src/api/filesystem.test.ts 全部 16 个测试 - FileSystem 构造函数参数错误

**问题类型**: 测试文件参数错误

**修复方案**: 将 `new FileSystem(mux)` 改为 `new FileSystem(() => mux)`。

**状态**: 已修复 (commit 15e15a9)

---

## 6. src/api/file.test.ts 全部测试超时 - MockTransport.onData 未保存回调

**问题类型**: 测试文件遗漏步骤

**问题描述**: MockTransport 的 `onData` 方法是空实现 `{}`，不保存回调。Multiplexer 构造时调用 `transport.onData(callback)` 注册数据处理器，但 MockTransport 未保存。`send()` 中调用 `this.dataCallback?.(resp)` 时 dataCallback 为 null，响应永远不会传递给 Multiplexer，请求永远 pending 直到超时。

**源码分析** (`src/api/file.test.ts:37`):
```typescript
onData(_callback: (chunk: Buffer) => void): void {}
```

Multiplexer 注册 (`src/transport/multiplexer.ts:80-84`):
```typescript
this.transport.onData((chunk) => {
  const frames = this.framer.feed(chunk);
  for (const frame of frames) {
    this.handleFrame(frame);
  }
});
```

**错误信息**: 测试超时 (30s)

**问题来源**: MockTransport 设计为通过 responseQueue 自动响应，但未正确集成 Multiplexer 的 onData 回调机制。

**修复方案**: 在 MockTransport.onData 中保存回调：`this.dataCallback = callback`。

**状态**: 待修复
