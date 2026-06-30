# XrdMacaroons 模块分析

## 1. 模块概述

**XrdMacaroons** 是 XRootD 服务器的一个可插拔插件模块，为 XRootD 的 HTTP 接口提供 **Macaroon 授权令牌**支持。Macaroon 是由 Google 研究人员提出的一种加密授权令牌，旨在提供灵活的、去中心化的访问控制，作为传统 Bearer Token 和 OAuth 令牌的替代方案。

### 核心功能

- **令牌签发**：通过 HTTP POST 请求为用户签发带有特定限制条件（caveats）的 Macaroon 令牌
- **令牌验证**：验证传入请求中的 Macaroon 令牌的签名、过期时间、路径限制和权限范围
- **权限衰减**：Caveats 只能限制权限，不能增加权限，支持路径限制、活动类型限制和过期时间限制
- **OAuth 2.0 兼容**：支持 OAuth 2.0 风格的令牌端点（`/.oauth2/token`）

### 支持的 Caveat 类型

| Caveat | 说明 |
|--------|------|
| `name:<username>` | 获取初始 Macaroon 的用户身份 |
| `path:<path>` | 路径限制，令牌只能在指定路径内使用 |
| `activity:<type>` | 允许的活动类型 |
| `before:<ISO8601>` | 令牌过期时间 |

### 支持的活动类型

| 活动 | 允许的操作 |
|------|-----------|
| `READ_METADATA` | `stat` |
| `UPDATE_METADATA` | `chmod`, `chown` |
| `LIST` | `readdir` |
| `DOWNLOAD` | `read` |
| `UPLOAD` | `rename`, `create`, `insert` |
| `MANAGE` | `insert`, `lock`, `mkdir`, `update`, `create`, `overwrite` |
| `DELETE` | `rm`, `rmdir` |

---

## 2. 文件列表与作用

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | CMake 构建配置，定义插件编译目标、依赖项和安装规则 |
| `export-lib-symbols` | Linux 符号可见性脚本，仅导出必要的公共符号 |
| `README.md` | 模块文档，说明 Macaroon 机制、使用方法和配置方式 |
| `XrdMacaroons.cc` | **插件入口**，定义 `XrdAccAuthorizeObject`、`XrdAccAuthorizeObjAdd`、`XrdHttpGetExtHandler` 三个外部 C 接口，用于将 Macaroon 模块注册到 XRootD 的授权框架和 HTTP 扩展处理器中 |
| `XrdMacaroonsAuthz.hh` | 授权检查器的头文件，定义 `Macaroons::Authz` 类，实现 `XrdAccAuthorize` 接口 |
| `XrdMacaroonsAuthz.cc` | 授权检查器的实现，核心验证逻辑：反序列化 Macaroon 令牌、验证 HMAC 签名、检查 caveats（name/path/activity/before） |
| `XrdMacaroonsConfigure.cc` | 配置解析，处理 `all.sitename`、`macaroons.secretkey`、`macaroons.maxduration`、`macaroons.trace`、`macaroons.onmissing` 等配置指令 |
| `XrdMacaroonsHandler.hh` | HTTP 扩展处理器的头文件，定义 `Macaroons::Handler` 类，实现 `XrdHttpExtHandler` 接口 |
| `XrdMacaroonsHandler.cc` | HTTP 处理器的实现：处理 Macaroon 请求的 POST、OAuth 令牌端点、令牌签发逻辑，包含 caveats 生成和交集运算 |
| `XrdMacaroonsUtils.hh` | 工具函数头文件，声明 `NormalizeSlashes` 和 `determine_validity` |
| `XrdMacaroonsUtils.cc` | 工具函数实现：路径斜杠规范化和 ISO 8601 时长字符串解析为秒数 |

---

## 3. 重要文件详细分析

### 3.1 XrdMacaroons.cc — 插件入口

**文件路径**: `src/XrdMacaroons/XrdMacaroons.cc`

该文件是整个模块的入口点，通过 `extern "C"` 导出三个关键函数：

- **`XrdAccAuthorizeObject()`**（第53行）：标准授权对象工厂函数。当参数中指定链式授权库时，通过 `dlopen`/`dlsym` 动态加载并链式调用底层授权库；否则使用 XRootD 默认授权对象。最终创建 `Macaroons::Authz` 实例。
- **`XrdAccAuthorizeObjAdd()`**（第33行）：新增授权对象的工厂函数，用于在已有授权链上叠加 Macaroon 授权层。
- **`XrdHttpGetExtHandler()`**（第124行）：HTTP 扩展处理器工厂函数，从环境变量中获取授权对象指针并创建 `Macaroons::Handler` 实例。

该文件还导出了全局指针 `SciTokensHelper`，用于与 XrdSciTokens 模块集成。

### 3.2 XrdMacaroonsAuthz — 授权验证核心

**文件路径**: `src/XrdMacaroons/XrdMacaroonsAuthz.cc`

这是模块最核心的验证逻辑文件，包含：

**内部类 `AuthzCheck`**（第19-57行）：封装每次请求的验证状态，提供四个静态回调函数作为 `libmacaroons` 验证器的 predicate：
- `verify_before_s()` — 验证 `before:` caveat，检查令牌是否过期，并确保不超过配置的最大有效期
- `verify_activity_s()` — 验证 `activity:` caveat，将请求操作映射到活动类型并检查权限
- `verify_path_s()` — 验证 `path:` caveat，检查请求路径是否在令牌授权路径内（支持子目录匹配）
- `verify_name_s()` — 验证 `name:` caveat，提取用户身份信息

**`Authz::Access()` 方法**（第163行）：主入口方法，执行完整验证流程：
1. 从请求环境或 ZTN 会话中提取令牌
2. 反序列化 Macaroon 令牌
3. 创建验证器并注册四个 caveat 验证器
4. 验证 location 是否匹配当前站点
5. 使用共享密钥验证 HMAC 签名
6. 验证通过后返回对应权限

**`Authz::Validate()` 方法**（第274行）：简化验证方法，用于会话令牌的快速验证，只检查过期时间和 HMAC 签名。

**操作到活动的映射**（第345-388行）：
- `AOP_Stat` → `READ_METADATA`
- `AOP_Chmod/Chown` → `UPDATE_METADATA`
- `AOP_Read` → `DOWNLOAD`
- `AOP_Delete` → `DELETE`
- `AOP_Readdir` → `LIST`
- `AOP_Rename/Excl_Create/Excl_Insert` → `UPLOAD`
- `AOP_Insert/Lock/Mkdir/Update/Create` → `MANAGE`

### 3.3 XrdMacaroonsHandler — HTTP 处理器

**文件路径**: `src/XrdMacaroons/XrdMacaroonsHandler.cc`

该文件实现了 HTTP 请求处理，主要功能：

**`ProcessReq()` 方法**（第291行）：主请求分发器：
- `/.well-known/oauth-authorization-server` → 返回 OAuth 配置信息
- `/.oauth2/token` → OAuth 2.0 风格令牌端点
- 其他 POST 请求 → Macaroon 令牌请求

**`ProcessTokenRequest()` 方法**（第172行）：处理 OAuth 2.0 风格的令牌请求（`application/x-www-form-urlencoded` 格式），解析 `grant_type`、`expire_in`、`scope` 参数。

**`GenerateMacaroonResponse()` 方法**（第399行）：核心令牌签发逻辑：
1. 计算过期时间（不超过最大有效期）
2. 通过授权链生成当前用户允许的活动列表
3. 将用户请求的活动与允许活动取交集（只能衰减，不能增加）
4. 使用 `libmacaroons` 库创建 Macaroon 并依次添加 name、activity、path、before 四个 caveat
5. 序列化为 Base64 并以 JSON 格式返回

**`GenerateActivities()` 方法**（第117行）：根据用户的授权权限生成活动列表字符串。

### 3.4 XrdMacaroonsConfigure — 配置解析

**文件路径**: `src/XrdMacaroons/XrdMacaroonsConfigure.cc`

解析 XRootD 配置文件中的指令：

| 配置指令 | 默认值 | 说明 |
|----------|--------|------|
| `all.sitename` | （必填） | 站点名称，用作 Macaroon 的 location 字段 |
| `macaroons.secretkey` | （必填） | Base64 编码的密钥文件路径，用于 HMAC 签名（最少 32 字节） |
| `macaroons.maxduration` | 86400 (24h) | 令牌最大有效期（秒） |
| `macaroons.trace` | error,warning | 日志级别：all/error/warning/info/debug/off |
| `macaroons.onmissing` | passthrough | 无令牌时行为：passthrough/allow/deny |

密钥通过 OpenSSL BIO 链进行 Base64 解码，确保安全性。

### 3.5 XrdMacaroonsUtils — 工具函数

**文件路径**: `src/XrdMacaroons/XrdMacaroonsUtils.cc`

- **`NormalizeSlashes()`**：将连续多个斜杠合并为单个斜杠（例如 `//foo////bar` → `/foo/bar`），但不处理路径层级解析（不处理 `..` 和 `.`）
- **`determine_validity()`**：解析 ISO 8601 持续时间格式（`PT<n>H<n>M<n>S`），支持小时(H)、分钟(M)、秒(S)单位

### 3.6 CMakeLists.txt — 构建配置

- 构建为动态加载的 MODULE 库（`add_library(... MODULE ...)`）
- 依赖条件：`ENABLE_MACAROONS` 必须开启，且需要 `Macaroons` 和 `json-c` 两个外部库
- 链接依赖：`XrdHttpUtils`、`XrdUtils`、`XrdServer`、`uuid`、`OpenSSL::Crypto`、`libmacaroons`、`json-c`

### 3.7 export-lib-symbols — 符号导出控制

仅导出 4 个公共符号：
- `XrdAccAuthorizeObject*`
- `XrdAccAuthorizeObjAdd*`
- `XrdHttpGetExtHandler*`
- `SciTokensHelper`

所有其他符号均设为 `local`（隐藏）。

---

## 4. 模块依赖关系

### 4.1 该模块依赖的模块/库

| 依赖 | 类型 | 用途 |
|------|------|------|
| `XrdHttpUtils` | XRootD 内部 | HTTP 扩展处理器基础设施 |
| `XrdUtils` | XRootD 内部 | 通用工具函数 |
| `XrdServer` | XRootD 内部 | 服务器基础设施 |
| `XrdAcc` | XRootD 内部 | 授权框架接口（`XrdAccAuthorize`） |
| `XrdSec` | XRootD 内部 | 安全实体定义（`XrdSecEntity`） |
| `XrdOuc` | XRootD 内部 | 配置流、环境变量管理 |
| `XrdSys` | XRootD 内部 | 错误处理和日志 |
| `XrdSciTokens` | XRootD 内部 | SciTokens 辅助接口（`XrdSciTokensHelper`） |
| `libmacaroons` | 外部第三方 | Macaroon 令牌的创建、序列化、反序列化和验证 |
| `json-c` | 外部第三方 | JSON 解析和生成（请求/响应处理） |
| `OpenSSL` | 外部第三方 | Base64 密钥解码、加密操作 |
| `libuuid` | 外部第三方 | 生成 Macaroon 唯一标识符（UUID） |

### 4.2 依赖该模块的模块

根据代码库搜索结果，**XrdMacaroons** 作为一个独立的插件模块，**没有其他模块直接依赖它**。它通过以下方式被集成到 XRootD 系统中：

1. **CMake 构建系统**：在 `src/CMakeLists.txt` 中通过 `add_subdirectory(XrdMacaroons)` 被构建
2. **运行时动态加载**：XRootD 服务器在启动时根据配置指令动态加载：
   - `ofs.authlib libXrdMacaroons.so` — 加载为授权库
   - `http.exthandler xrdmacaroons libXrdMacaroons.so` — 加载为 HTTP 扩展处理器
3. **测试目录**：`tests/XrdMacaroons/` 包含针对工具函数的单元测试

---

## 5. 架构总结

```
┌─────────────────────────────────────────────────────────┐
│                    XRootD HTTP Server                    │
│                                                         │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │   XrdHttpExtReq  │───▶│  Macaroons::Handler      │   │
│  │   (HTTP 请求)     │    │  - ProcessReq()          │   │
│  └──────────────────┘    │  - ProcessTokenRequest() │   │
│                          │  - GenerateMacaroonResp() │   │
│                          └────────────┬─────────────┘   │
│                                       │                  │
│                          ┌────────────▼─────────────┐   │
│  ┌──────────────────┐    │  Macaroons::Authz         │   │
│  │  XrdAccAuthorize │◀───│  - Access()              │   │
│  │  (授权框架)       │    │  - Validate()            │   │
│  └──────────────────┘    │  - AuthzCheck 验证器      │   │
│                          └──────────────────────────┘   │
│                                       │                  │
│                          ┌────────────▼─────────────┐   │
│                          │  libmacaroons (外部)      │   │
│                          │  - macaroon_create()      │   │
│                          │  - macaroon_verify()      │   │
│                          │  - macaroon_serialize()   │   │
│                          └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

模块采用经典的**双入口**设计：
- **授权入口**（`XrdAccAuthorizeObjAdd`）：作为授权插件链中的一环，验证每个请求中的 Macaroon 令牌
- **HTTP 入口**（`XrdHttpGetExtHandler`）：作为 HTTP 扩展处理器，处理令牌签发请求

两个入口共享配置逻辑（`Handler::Config` 静态方法），确保授权验证和令牌签发使用相同的密钥和站点配置。
