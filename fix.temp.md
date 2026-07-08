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

**问题描述**: 测试使用 `new FileSystem(mux)` 直接传入 Multiplexer 实例，但源码构造函数期望接收一个工厂函数 `() => Multiplexer`。

**源码分析** (`src/api/filesystem.ts:17-22`):
```typescript
export class FileSystem {
  private readonly getMux: () => Multiplexer;

  constructor(getMux: () => Multiplexer) {
    this.getMux = getMux;
  }
}
```

调用处 (`src/api/filesystem.ts:26`):
```typescript
const frame = await sendRequest(this.getMux(), req);
```

**错误信息**: `TypeError: this.getMux is not a function`

**问题来源**: 测试编写时源码构造函数签名可能尚未改为工厂函数模式，测试未同步更新。

**修复方案**: 将 `new FileSystem(mux)` 改为 `new FileSystem(() => mux)`。

**状态**: 待修复
