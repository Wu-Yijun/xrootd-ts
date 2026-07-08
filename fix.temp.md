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

**问题描述**: 两个测试与同文件其他测试矛盾：
- 第 19-24 行 "returns hostname as credentials" 断言凭据是 `"testhost.example.com"`
- 第 26-31 行 'returns "unknown" when host is empty' 断言凭据是 `"unknown"`
- 但第 50-56 行 "credentials contain NUL terminator" 断言 `creds.length === 5`，证实凭据实际是 `"host\0"`（5 字节）

**源码分析** (`src/security/host.ts:8-12`):
```typescript
async getCredentials(params: AuthParams): Promise<Uint8Array> {
  // C++ host protocol sends "host\0" (5 bytes) as credential data.
  // The null terminator is required for PManager.Find() strcmp() matching.
  return new TextEncoder().encode("host\0");
}
```

源码行为正确，与 XRootD C++ 参考实现一致。host 协议凭据是固定字符串 `"host\0"`，不依赖 params.host。

**问题来源**: 测试编写者未理解 host 协议规范，错误假设凭据应是 hostname。同文件第 50-56 行的测试已正确验证了实际行为。

**修复方案**: 将第 19-24 行和第 26-31 行的断言改为验证实际返回值 `"host\0"`。

**状态**: 待修复
