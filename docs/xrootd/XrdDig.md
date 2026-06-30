# XrdDig 模块分析

## 1. 模块概述

XrdDig 是 XRootD 的一个文件系统插件模块，提供对服务器系统文件的只读访问功能。该模块允许授权客户端通过 XRootD 协议访问服务器上的配置文件、日志、核心转储文件和 /proc 文件系统等敏感资源，同时实施严格的访问控制策略。

## 2. 文件列表与功能说明

| 文件名 | 功能描述 |
|--------|----------|
| CMakeLists.txt | 构建配置文件，将源文件编译到 XrdServer 目标中 |
| XrdDigAuth.hh | 授权模块头文件，定义访问控制实体和授权类接口 |
| XrdDigAuth.cc | 授权模块实现，解析授权文件并执行客户端权限验证 |
| XrdDigConfig.hh | 配置模块头文件，定义配置管理和路径生成功能 |
| XrdDigConfig.cc | 配置模块实现，处理配置参数、路径映射和定位响应 |
| XrdDigFS.hh | 文件系统接口头文件，定义目录、文件和文件系统类 |
| XrdDigFS.cc | 文件系统接口实现，提供完整的 XrdSfsFileSystem 接口 |

## 3. 详细架构分析

### 3.1 XrdDigAuth（授权模块）

**核心类：**
- `XrdDigAuthEnt` - 授权条目实体，存储单条授权规则
  - `eType`: 实体检查类型（name, host, vorg, role, grp）
  - `aType`: 资源访问类型（conf, core, logs, proc）
  - `accOK[]`: 各资源类型的访问权限标志

- `XrdDigAuth` - 授权管理器
  - `Authorize()`: 验证客户端是否有权访问指定资源类型
  - `Configure()`: 加载并解析授权配置文件
  - `Refresh()`: 自动刷新授权列表（基于文件修改时间）

**授权文件格式：**
```
[access_types] protocol n=<name> h=<host> o=<vorg> r=<role> g=<group>
```
- access_types: all, conf, core, logs, proc（可加 - 前缀表示拒绝）
- protocol: 安全协议标识符
- 实体匹配字段: n(name), h(host), o(vorg), r(role), g(group)

### 3.2 XrdDigConfig（配置模块）

**核心功能：**
- `Configure()`: 初始化配置，设置文件路径模板
- `GenPath()`: 将逻辑文件名转换为物理路径并进行授权检查
- `GenAccess()`: 生成客户端可访问的资源列表
- `GetLocResp()`: 生成文件定位响应（支持 IPv4/IPv6）

**配置参数：**
- 文件路径模板: `$XRDADMINPATH/.xrd/=/%s`
- 资源前缀: conf, core, logs, proc
- 日志选项: log [grant] [deny] | none
- addconf 指令: 添加配置文件到 /=/conf/etc/ 虚拟路径

**安全措施：**
- `/proc` 文件系统访问验证（防止符号链接攻击）
- 路径规范化检查
- 访问审计日志

### 3.3 XrdDigFS（文件系统接口）

**类层次结构：**
```
XrdSfsFileSystem
  └── XrdDigFS          # 文件系统主类

XrdSfsDirectory
  └── XrdDigDirectory   # 目录操作类

XrdSfsFile
  └── XrdDigFile        # 文件操作类
```

**支持的操作：**
- 目录: open, nextEntry, close
- 文件: open, close, read, readv, stat, fctl
- 文件系统: exists, fsctl, stat, getVersion

**限制操作（返回 EROFS）：**
- chmod, mkdir, rem, remdir, rename, truncate, write

**特殊功能：**
- 根目录 `/` 列出客户端有权限访问的资源类型
- `/proc` 文件系统特殊处理（扩展符号链接信息）
- 异步 I/O 支持（read with AIO）

### 3.4 入口函数

```cpp
XrdSfsFileSystem *XrdDigGetFS(XrdSfsFileSystem *native_fs,
                              XrdSysLogger     *lp,
                              const char       *cFN,
                              const char       *parms);
```

这是 XRootD 插件的标准入口点，负责初始化配置并返回文件系统实例。

## 4. 依赖关系

### 4.1 本模块依赖的外部模块

| 模块 | 用途 |
|------|------|
| XrdSec | 安全认证接口（XrdSecEntity, XrdSecClientName） |
| XrdSys | 系统工具（错误处理、线程、日志） |
| XrdOuc | 对象工具类（流、错误信息、环境、分词器） |
| XrdNet | 网络工具（地址处理、IPv4/IPv6 转换） |
| XrdSfs | 文件系统接口定义（XrdSfsFileSystem, XrdSfsFile, XrdSfsDirectory） |
| XrdVersion | 版本信息宏 |

### 4.2 依赖本模块的模块

从 CMakeLists.txt 分析：
- **XrdServer**: XrdDig 源文件被编译到 XrdServer 目标中，作为服务器端文件系统插件加载

## 5. 数据流

```
客户端请求
    ↓
XrdDigFS (入口)
    ↓
XrdDigFS::Validate() ← 路径验证
    ↓
XrdDigConfig::GenPath() ← 路径映射 + 授权检查
    ↓
XrdDigAuth::Authorize() ← 权限验证
    ↓
XrdDigUFS (底层 Unix 操作)
    ↓
返回结果
```

## 6. 关键设计特点

1. **只读设计**: 仅支持读取操作，所有写入操作被拒绝
2. **基于文件的授权**: 授权规则存储在外部文件中，支持热重载
3. **资源隔离**: 通过前缀（conf, core, logs, proc）隔离不同类型的系统资源
4. **安全加固**:
   - /proc 文件系统符号链接检查
   - 路径规范化验证
   - 写权限位被清除（st_mode &= ~wMask）
5. **IPv6 支持**: 定位响应支持 IPv4/IPv6 双栈
6. **审计日志**: 可配置记录成功/失败的访问尝试

## 7. 使用场景

XrdDig 模块典型用于：
- 远程查看服务器配置文件
- 访问应用程序日志
- 读取核心转储文件进行调试
- 通过 /proc 监控服务器进程状态
- 集中式监控系统收集多台服务器信息
