# Test Fix Analysis

## 1. src/protocol/message.test.ts:491-504 - buildMkdirRequest mode offset 错误

**问题类型**: 测试文件断言错误

**问题描述**: 测试断言 `buf.readUInt16BE(17)` 获取 mode，但源码实际写入 offset 18-19。

**修复方案**: 将 `readUInt16BE(17)` 改为 `readUInt16BE(18)`。

**状态**: 已修复 (commit 30ec8f5)

---

## 2. src/transport/framer.test.ts:179-203 - streamId 类型断言错误

**问题类型**: 测试文件断言错误

**问题描述**: 测试将 `frame.streamId`（Buffer 类型）与数字进行 `strictEqual` 比较。

**修复方案**: 使用 `readUInt16BE(0)` 从 Buffer 中读取数值。

**状态**: 已修复 (commit 93bd477)

---

## 3. src/transport/multiplexer.test.ts:309-344 - redirectCount 初始化测试缺少 onRedirect

**问题类型**: 测试文件遗漏步骤

**问题描述**: 测试 `redirectCount can be initialized from options` 创建 Multiplexer 时传入 `redirectCount: 1` 但未提供 `onRedirect` 处理函数。当收到 redirect 响应 (4004) 时，源码调用 `handleRedirectResponse` 检查 `onRedirect` 是否存在，不存在则 reject 错误。

**源码分析** (`src/transport/multiplexer.ts:270-276`):
```typescript
} else {
  pending.reject(
    new Error(`Redirect to ${host}:${port} but no onRedirect handler configured`),
  );
}
```

**错误行为分析**: 这是测试遗漏，不是源码 bug。源码明确要求 redirect 必须提供 `onRedirect` 处理器。测试只验证了 redirectCount 初始化（第 315 行 `assert.equal(redirectMux.getRedirectCount(), 1)` 是通过的），但后续测试 redirect 重试流程时未提供必要依赖。

**修复方案**: 在 Multiplexer 构造选项中添加 `onRedirect` mock 函数。

**状态**: 待修复
