# XrdAcc 模块分析

## 1. 模块概述

XrdAcc 是 XRootD 的**授权(Authorization)模块**，负责基于文件路径和操作类型对客户端访问进行权限控制。它实现了基于能力(Capability)的授权框架，支持按用户、主机、组、角色、组织等多维度进行细粒度的权限管理。

该模块的核心职责：
- 从授权数据库文件加载权限规则
- 根据客户端身份信息匹配对应的权限集
- 判断特定操作是否被允许
- 提供审计日志记录能力
- 支持动态刷新权限配置

## 2. 文件列表与作用

| 文件名 | 作用 |
|--------|------|
| `XrdAccAuthorize.hh` | 定义授权抽象接口 `XrdAccAuthorize` 和操作枚举 `Access_Operation`，是模块的对外 API |
| `XrdAccAccess.hh` | 授权核心实现类 `XrdAccAccess`，继承自 `XrdAccAuthorize`，实现基于规则表的权限匹配 |
| `XrdAccAccess.cc` | `XrdAccAccess` 的实现，包含 `Access()` 权限检查主逻辑、`Test()` 操作验证和 `SwapTabs()` 表切换 |
| `XrdAccAuthDB.hh` | 授权数据库抽象接口 `XrdAccAuthDB`，定义获取权限记录的迭代器接口 |
| `XrdAccAuthFile.hh` | 基于文件的授权数据库实现类 `XrdAccAuthFile`，继承自 `XrdAccAuthDB` |
| `XrdAccAuthFile.cc` | `XrdAccAuthFile` 的实现，从磁盘文件解析授权记录 |
| `XrdAccCapability.hh` | 能力类 `XrdAccCapability`，表示路径到权限的映射，支持前缀匹配和模板 |
| `XrdAccCapability.cc` | `XrdAccCapability` 的实现，包含路径匹配算法和 `@=` 替换语法 |
| `XrdAccConfig.hh` | 配置管理类 `XrdAccConfig`，负责解析配置文件和授权数据库 |
| `XrdAccConfig.cc` | `XrdAccConfig` 的实现，包含配置指令解析、数据库记录处理和周期刷新线程 |
| `XrdAccEntity.hh` | 客户端实体信息类 `XrdAccEntity`，从安全上下文中提取 vorg/role/grup 属性 |
| `XrdAccEntity.cc` | `XrdAccEntity` 的实现，负责实体属性的解析和缓存 |
| `XrdAccGroups.hh` | 组管理类 `XrdAccGroups`，管理 Unix 组和 NIS netgroup 的查询与缓存 |
| `XrdAccGroups.cc` | `XrdAccGroups` 的实现，包含组查找、netgroup 查询和缓存管理 |
| `XrdAccPrivs.hh` | 权限定义头文件，定义权限枚举 `XrdAccPrivs`、权限规范 `XrdAccPrivSpec` 和能力结构 `XrdAccPrivCaps` |
| `XrdAccAudit.hh` | 审计接口类 `XrdAccAudit`，定义访问授权和拒绝的审计记录接口 |
| `XrdAccAudit.cc` | `XrdAccAudit` 的默认实现，将审计消息输出到日志系统 |
| `CMakeLists.txt` | CMake 构建配置，将所有源文件编译为 `XrdServer` 目标的一部分 |

## 3. 核心架构

### 3.1 类继承关系

```
XrdAccAuthorize (抽象接口)
  └── XrdAccAccess (核心实现)

XrdAccAuthDB (抽象接口)
  └── XrdAccAuthFile (文件实现)

XrdSecAttr (安全属性基类)
  └── XrdAccEntity (授权实体)

XrdAccAudit (审计基类)
  (可通过插件替换)
```

### 3.2 权限检查流程

```
客户端请求 → Access(Entity, path, oper)
  ├── 1. 获取 XrdAccEntity (从安全上下文中解析 vorg/role/grup)
  ├── 2. 获取用户名 (request.name 或 Entity->name)
  ├── 3. 解析主机名 (可能需要 DNS 反向解析)
  ├── 4. 按优先级匹配权限规则:
  │     ├── 独占规则 (SXList) → 首先检查，命中即返回
  │     ├── 默认规则 (Z_List) → 基础权限
  │     ├── 域规则 (D_List) → 按主机域名匹配
  │     ├── 主机规则 (H_Hash) → 按主机名匹配
  │     ├── Netgroup 规则 (N_Hash) → 按 netgroup 匹配
  │     ├── 可变用户规则 (X_List) → 按用户匹配
  │     ├── 用户规则 (U_Hash) → 按用户名匹配
  │     ├── 组规则 (G_Hash) → 按 Unix 组匹配
  │     ├── 组织规则 (O_Hash) → 按虚拟组织匹配
  │     ├── 角色规则 (R_Hash) → 按角色匹配
  │     └── 包容规则 (SYList) → 所有匹配的规则都应用
  ├── 5. 计算最终权限: pprivs & ~nprivs
  ├── 6. 测试操作权限: Test(priv, oper)
  └── 7. 审计记录 (如果启用)
```

### 3.3 权限数据库记录格式

```
<记录类型> <记录名> <路径/模板> <权限> [路径/模板 权限 ...]

记录类型:
  g = Unix 组名
  h = 主机名
  n = NIS netgroup 名
  o = 组织名
  r = 角色名
  s = 集合名 (支持 = 定义，x 独占规则)
  t = 模板名
  u = 用户名 (* 表示所有用户, = 表示可变用户)
  x = 独占规则
  = = 默认规则

权限字符:
  a = 所有权限
  d = 删除 (delete)
  i = 插入 (insert/mkdir)
  k = 锁定 (lock)
  l = 查找 (lookup/stat)
  n = 重命名 (rename)
  r = 读取 (read/readdir)
  w = 写入 (write)
  - = 否定权限 (后面的权限被移除)
```

## 4. 依赖关系

### 4.1 XrdAcc 依赖的模块

| 模块 | 用途 |
|------|------|
| `XrdSys` | 系统工具：错误处理(`XrdSysError`)、线程(`XrdSysPthread`)、互斥锁(`XrdSysXSLock`)、平台适配(`XrdSysPlatform`)、密码管理(`XrdSysPwd`)、插件加载(`XrdSysPlugin`) |
| `XrdOuc` | 通用工具：哈希表(`XrdOucHash`)、流处理(`XrdOucStream`)、环境变量(`XrdOucEnv`)、锁定(`XrdOucLock`)、类型转换(`XrdOuca2x`)、分词器(`XrdOucTokenizer`)、URI解码(`XrdOucUri`)、工具函数(`XrdOucUtils`) |
| `XrdSec` | 安全模块：安全实体(`XrdSecEntity`)、安全属性(`XrdSecAttr`、`XrdSecEntityAttr`) |
| `XrdNet` | 网络模块：地址信息(`XrdNetAddrInfo`)，用于主机名解析 |
| `XrdVersion` | 版本兼容性检查 |

### 4.2 依赖 XrdAcc 的模块

| 模块 | 引用的头文件 | 用途 |
|------|-------------|------|
| `XrdOfs` | `XrdAccAuthorize.hh`、`XrdAccAccess.hh` | 文件系统操作的权限检查 |
| `XrdBwm` | `XrdAccAuthorize.hh` | 带宽管理器的权限检查 |
| `XrdSciTokens` | `XrdAccAuthorize.hh` | SciTokens 授权插件 |
| `XrdMacaroons` | `XrdAccAuthorize.hh`、`XrdAccPrivs.hh` | Macaroon 令牌授权插件 |
| `XrdApps` | `XrdAccAuthorize.hh`、`XrdAccConfig.hh`、`XrdAccGroups.hh`、`XrdAccPrivs.hh` | 授权测试工具 (`XrdAccTest`) |

## 5. 重要配置指令

| 指令 | 默认值 | 说明 |
|------|--------|------|
| `acc.authdb` | `/opt/xrd/etc/Authfile` 或 `/etc/xrootd/authdb` | 授权数据库文件路径 |
| `acc.authrefresh` | 12 小时 | 授权数据库刷新间隔(秒) |
| `acc.audit` | `none` | 审计选项: `deny`/`grant`/`none` |
| `acc.encoding` | - | 编码选项: `space <char>` 空格替换符、`pct path` URI 百分号编码 |
| `acc.gidlifetime` | 12 小时 | GID 缓存生命周期(秒) |
| `acc.gidretran` | - | 需要重新翻译的 GID 列表 |
| `acc.nisdomain` | - | NIS 域名，用于 netgroup 查询 |
| `acc.pgo` | 关闭 | 仅使用主组的 SVR4 语义 |

## 6. 关键设计要点

1. **线程安全**: 使用读写锁(`XrdSysXSLock`)保护权限表，支持并发读取，独占写入
2. **热加载**: 支持周期性检查授权数据库文件变更并自动刷新，无需重启服务
3. **插件架构**: `XrdAccAuthorize` 是纯虚基类，可通过共享库插件替换整个授权逻辑
4. **路径匹配**: 支持前缀匹配和 `@=` 替换语法（例如 `/data/@=user/@=` 实现用户隔离路径）
5. **缓存机制**: Unix 组和 netgroup 查询结果带有可配置的缓存过期时间
6. **规则优先级**: 独占规则 (`x`) 最先匹配，匹配即返回；包容规则 (`s` 中非独占部分) 所有匹配的都会叠加应用
