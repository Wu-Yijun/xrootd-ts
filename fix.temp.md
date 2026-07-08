# Test Fix Analysis

## 1. src/protocol/message.test.ts:491-504 - buildMkdirRequest mode offset 错误

**问题类型**: 测试文件断言错误

**问题描述**: 测试断言 `buf.readUInt16BE(17)` 获取 mode，但源码实际写入 offset 18-19。

**修复方案**: 将 `readUInt16BE(17)` 改为 `readUInt16BE(18)`。

**状态**: 已修复 (commit 30ec8f5)

---

## 2. src/transport/framer.test.ts:179-203 - streamId 类型断言错误

**问题类型**: 测试文件断言错误

**问题描述**: 测试将 `frame.streamId` 与数字进行 `strictEqual` 比较，但 `Frame.streamId` 类型是 `Buffer`（2 字节 Uint8Array），不是 `number`。

**源码分析** (`src/transport/framer.ts:30-31`):
```typescript
frames.push({
  streamId: this.pending.subarray(0, 2),  // Buffer/Uint8Array
  ...
});
```

**错误信息**:
- `Buffer(2) [0, 0] !== 0`
- `Buffer(2) [255, 255] !== 65535`
- `Buffer(2) [0, 42] !== 42`

**修复方案**: 使用 `readUInt16BE(0)` 从 Buffer 中读取数值，或使用 `deepEqual` 比较字节数组。

**状态**: 待修复
