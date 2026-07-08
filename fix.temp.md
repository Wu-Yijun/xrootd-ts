# Test Fix Analysis

## 1. src/protocol/message.test.ts:491-504 - buildMkdirRequest mode offset 错误

**问题类型**: 测试文件断言错误

**问题描述**: 测试 `contains path with mode at offset 17-18` 断言 `buf.readUInt16BE(17)` 获取 mode 值，但 `buildMkdirRequest` 实际将 mode 写入 offset 18-19。

**源码分析** (`src/protocol/builders.ts:331-336`):
```
msg.writeBytes(streamIdToBytes(streamId));  // offset 0-1
msg.writeInt16BE(RequestId.Mkdir);          // offset 2-3
msg.writeUInt8(0);                           // offset 4 (1 byte)
msg.writeBytes(new Uint8Array(13));          // offset 5-17 (13 bytes)
msg.writeInt16BE(mode & 0xffff);            // offset 18-19 ← mode 在此
```

Header body 16 字节 (offset 4-19)：mode 在 body 最后 2 字节 (offset 18-19)。

**错误信息**: `actual: 1, expected: 493` (1 = buf[17] = reserved byte, 493 = 0o755)

**问题来源**: 测试编写者计算 body 内字段偏移量时少算了 1 字节。

**修复方案**: 将 `readUInt16BE(17)` 改为 `readUInt16BE(18)`。

**状态**: 待修复
