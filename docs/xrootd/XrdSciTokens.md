# XrdSciTokens 模块分析

## 1. 模块概述

XrdSciTokens 是 XRootD 框架的一个 **SciTokens 授权插件**（ACC Plugin），位于 `xrootd/src/XrdSciTokens/` 目录下。该模块利用 [SciTokens C 库](https://www.scitokens.org) 验证和提取传输过程中传递的 SciToken（一种基于 JWT 的科学授权令牌），实现基于令牌的文件访问控制。

### 核心功能

- **令牌验证与反序列化**：使用 `scitoken_deserialize()` 验证 JWT 签名和格式
- **ACL 生成**：从 SciToken 的 claims（如 `storage.read:/path`）生成 XRootD 内部访问控制规则
- **身份映射**：支持将令牌中的 `sub` claim 或自定义 claim 映射为本地 Unix 用户名
- **群组授权**：支持从 `wlcg.groups` 等 claim 提取群组信息，传递给下游授权插件
- **令牌缓存**：对已验证的令牌结果进行内存缓存，避免重复解析
- **配置热重载**：支持定期检查配置文件变化并重新加载
- **监控报告**：向 XRootD 监控系统报告令牌授权事件

---

## 2. 文件清单

### 源代码文件

| 文件名 | 说明 |
|--------|------|
| `CMakeLists.txt` | 构建配置，定义模块编译目标和依赖关系 |
| `XrdSciTokensAccess.cc` | **核心实现文件**，包含令牌验证、ACL 生成、配置解析和授权检查的全部逻辑（约 1497 行） |
| `XrdSciTokensHelper.hh` | 定义 `XrdSciTokensHelper` 抽象接口类，提供令牌验证和 Issuer 列表查询的 API |
| `XrdSciTokensMon.hh` | 定义 `XrdSciTokensMon` 监控辅助类，提供 I/O 操作识别和监控报告功能 |
| `XrdSciTokensMon.cc` | `XrdSciTokensMon` 的实现，通过 `XrdSecMonitor` 接口上报令牌授权信息 |

### 配置与示例文件

| 文件名 | 说明 |
|--------|------|
| `configs/scitokens.cfg` | 示例配置文件，展示如何配置 OSG-Connect 和 CMS 两个 Issuer |
| `configs/export-lib-symbols` | 链接器版本脚本，控制动态库导出符号（`XrdAccAuthorizeObject*`、`XrdAccAuthorizeObjAdd*`） |
| `configs/export-module-symbols` | 模块版本脚本，导出 `init_scitokens_xrootd*` 符号 |

### 测试文件

| 文件名 | 说明 |
|--------|------|
| `test/test_inside_docker.sh` | Docker 容器内运行测试的脚本 |
| `test/setup_tests.sh` | 测试环境初始化脚本 |
| `test/openssl-selfsigned.conf` | OpenSSL 自签名证书配置 |
| `test/create-pubkey.py` | Python 脚本，用于生成测试用公钥 |
| `test/config/xrootd-http.cfg` | 测试用 XRootD HTTP 配置 |
| `test/config/scitokens-aud.cfg` | 测试用 SciTokens 配置（带 audience） |
| `test/config/scitokens-no-aud.cfg` | 测试用 SciTokens 配置（无 audience） |
| `test/config/scitokens-multi-aud.cfg` | 测试用 SciTokens 配置（多 audience） |
| `test/config/override.conf` | 测试用覆盖配置 |

### 文档与许可

| 文件名 | 说明 |
|--------|------|
| `README.md` | 模块使用说明文档，涵盖配置、Mapfile 格式等 |
| `LICENSE` | 许可证文件 |

---

## 3. 重要文件详细结构分析

### 3.1 XrdSciTokensAccess.cc（核心实现）

这是整个模块的核心文件，包含约 1497 行代码，结构如下：

#### 包含的命名空间与枚举

```
- LogMask: 日志级别掩码（Debug, Info, Warning, Error, All）
- IssuerAuthz: 授权策略枚举（Capability, Group, Mapping, Default）
```

#### 核心类层次

```
XrdAccSciTokens（主类，约 1448 行）
  ├─ 继承自 XrdAccAuthorize（XRootD 授权接口）
  ├─ 继承自 XrdSciTokensHelper（SciTokens 验证接口）
  └─ 继承自 XrdSciTokensMon（监控辅助类）
```

#### 辅助类

| 类名 | 说明 |
|------|------|
| `OverrideINIReader` | 扩展 INIReader，支持同 section/name 覆盖写入 |
| `XrdAccRules` | 封装一条令牌的授权规则集合，支持路径匹配和过期检查 |
| `IssuerConfig` | 存储单个 Issuer 的配置信息（base_path、map_rules 等） |
| `MapRule` | 存储单条身份映射规则（sub、username、path、group 匹配） |

#### 关键函数

| 函数 | 行号 | 说明 |
|------|------|------|
| `Access()` | :508 | 主入口——XRootD 调用此函数检查请求权限，处理令牌解析、缓存和授权决策 |
| `GenerateAcls()` | :784 | 从 SciToken 生成 XRootD ACL 规则，处理 scope 到操作的映射 |
| `Config()` | :1050 | 初始化配置，读取 `scitokens.trace` 日志级别和 TLS 设置 |
| `Reconfig()` | :1204 | 解析 `scitokens.cfg` 配置文件，构建 Issuer 配置映射 |
| `ParseMapfile()` | :1124 | 解析 JSON 格式的身份映射文件 |
| `Validate()` | :698 | 纯令牌验证（不检查 scope），供外部模块调用 |
| `IssuerList()` | :673 | 返回已配置的有效 Issuer 列表 |
| `OnMissing()` | :769 | 处理令牌缺失或无效时的行为（passthrough/allow/deny） |
| `Check()` | :1406 | 定期清理过期缓存并触发配置重载 |
| `MakeCanonical()` | :201 | 路径规范化（消除 `..`、`.`、重复 `/`） |
| `IsSafeUsername()` | :192 | 用户名安全校验，防止路径遍历和 shell 注入 |
| `AddPriv()` | :90 | 将 Access_Operation 转换为 XrdAccPrivs 权限位 |
| `OpToName()` | :144 | 将操作枚举转换为可读字符串 |

#### 导出的 C 接口

```c
XrdAccAuthorizeObjAdd()   // 插件链模式入口（被 XRootD 调用）
XrdAccAuthorizeObject()   // 独立模式入口
XrdAccAuthorizeObject2()  // 带环境变量的独立模式入口
```

### 3.2 XrdSciTokensHelper.hh（公共接口）

定义了 `XrdSciTokensHelper` 抽象类，包含：

- `ValidIssuer` 结构体：存储 issuer 名称和 URL
- `IssuerList()` 纯虚函数：获取有效 Issuer 列表
- `Validate()` 纯虚函数：验证令牌有效性
- 插件加载后会导出 `SciTokensHelper` 全局符号供其他模块使用

### 3.3 XrdSciTokensMon.hh/cc（监控功能）

- `Mon_isIO()`：判断操作是否为 I/O 操作（Read、Update、Create、Excl_Create）
- `Mon_Report()`：通过 `XrdSecMonitor::TokenInfo` 上报令牌信息（subject、username、org、role、groups）

---

## 4. 依赖关系分析

### 4.1 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| **SciTokensCpp**（外部库） | SciToken 反序列化、enforcer 创建、ACL 生成 |
| **XrdUtils** | 基础工具类（`XrdVERSIONINFO` 宏等） |
| **XrdServer** | 服务器基础设施 |
| **XrdAcc/XrdAccAuthorize.hh** | XRootD 授权插件接口定义 |
| **XrdOuc/XrdOucEnv.hh** | 环境变量管理 |
| **XrdOuc/XrdOucGatherConf.hh** | 配置文件收集与解析 |
| **XrdOuc/XrdOucPrivateUtils.hh** | 私有工具函数 |
| **XrdSec/XrdSecEntity.hh** | 安全实体定义（携带身份信息） |
| **XrdSec/XrdSecEntityAttr.hh** | 安全实体属性操作 |
| **XrdSec/XrdSecMonitor.hh** | 监控接口 |
| **XrdSys/XrdSysLogger.hh** | 日志系统 |
| **XrdTls/XrdTlsContext.hh** | TLS 上下文（获取 CA 文件路径） |
| **INIReader（vendor/inih）** | INI 配置文件解析 |
| **picojson（vendor/picojson）** | JSON 解析（用于 mapfile 和 audience_json） |
| **pthread** | 读写锁（`pthread_rwlock_t`）用于配置热重载 |

### 4.2 依赖该模块的其他模块

| 依赖方 | 说明 |
|--------|------|
| **XrdSecztn** | 在 `XrdSecProtocolztn.cc:709` 中引用 `libXrdAccSciTokens.so`，用于 ZTN（Zero Trust Networking）协议中加载 SciTokens 授权插件 |
| **XRootD 主框架** | 通过 `XrdVersionPlugin.hh:180` 注册插件元数据，`ofs.authlib` 指令加载 |
| **外部授权插件链** | 通过 `SciTokensHelper` 全局符号获取令牌验证和 Issuer 列表查询能力 |

---

## 5. 构建配置分析

`CMakeLists.txt` 关键点：

- **条件编译**：需要 `ENABLE_SCITOKENS` 开启且 `SciTokensCpp` 库存在
- **构建目标**：`XrdAccSciTokens-${PLUGIN_VERSION}`（动态模块库）
- **链接依赖**：`XrdUtils`、`XrdServer`、`SCITOKENS_CPP_LIBRARIES`、`pthread`、`dl`
- **包含路径**：`vendor/inih`、`vendor/picojson`、SciTokensCpp 头文件
- **条件编译宏**：`HAVE_SCITOKEN_CONFIG_SET_STR`（当 SciTokensCpp 支持配置参数设置时定义）
- **安装位置**：`${CMAKE_INSTALL_LIBDIR}`（通常为 lib/）

---

## 6. 授权流程总结

```
XRootD 请求 → XrdAccSciTokens::Access()
  │
  ├─ 提取 authz（Bearer token 或 ZTN session token）
  │
  ├─ 无 token → OnMissing()（passthrough/allow/deny）
  │
  ├─ 检查缓存（m_map）
  │   ├─ 命中且未过期 → 使用缓存的 XrdAccRules
  │   └─ 未命中 → GenerateAcls()
  │       ├─ scitoken_deserialize() 反序列化
  │       ├─ enforcer_create() + enforcer_generate_acls() 生成 ACL
  │       ├─ 提取 username、groups、subject
  │       ├─ 构建 XrdAccRules 并缓存
  │       └─ 返回缓存结果
  │
  ├─ 三种授权策略检查：
  │   ├─ Capability: scope 匹配 → 直接授权
  │   ├─ Group: 有 groups → 设置 grps 字段，交给下游
  │   └─ Mapping: 用户名映射成功 → 设置 request.name，交给下游
  │
  └─ 返回 XrdAccPrivs 权限位
```

---

## 7. 配置文件格式

`scitokens.cfg` 使用 INI 格式：

```ini
[Global]
audience = <逗号分隔的 audience 列表>
audience_json = ["aud1", "aud2"]    # JSON 格式（优先级更高）
onmissing = passthrough|allow|deny  # 缺失令牌时的行为

[Issuer <名称>]
issuer = <Issuer URI>
base_path = <基础路径，逗号分隔>
restricted_path = <可选路径限制>
map_subject = True|False
default_user = <默认用户名>
username_claim = <自定义用户名 claim>
groups_claim = <自定义群组 claim，默认 wlcg.groups>
name_mapfile = <JSON 格式身份映射文件路径>
authorization_strategy = capability group mapping
```
