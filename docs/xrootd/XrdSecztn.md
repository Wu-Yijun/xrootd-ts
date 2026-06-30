# XrdSecztn 模块分析

## 模块概述

XrdSecztn 是 XRootD 框架中的一个安全认证插件模块，实现了 **"ztn"（Zero Trust Network）安全协议**。该模块负责在 XRootD 客户端和服务器之间进行基于令牌（Token）的身份验证，支持 JWT（JSON Web Token）格式的令牌验证。该模块以动态共享库（MODULE）的形式构建和加载，是 XRootD 安全框架中的可插拔认证协议之一。

## 文件列表

| 文件名 | 作用描述 |
|--------|----------|
| `CMakeLists.txt` | 构建配置文件，定义模块编译目标和依赖关系 |
| `XrdSecztn.cc` | JWT 令牌检测工具，包含 Base64 解码和 JWT 格式验证功能 |
| `XrdSecProtocolztn.cc` | 核心协议实现，包含客户端/服务器端认证逻辑和令牌处理 |

## 文件详细分析

### 1. CMakeLists.txt

构建配置文件，定义了以下内容：

- **模块名称**：`XrdSecztn-${PLUGIN_VERSION}`（版本号由外部变量决定）
- **构建类型**：`MODULE`（动态共享库，运行时可插拔加载）
- **源文件**：`XrdSecProtocolztn.cc` 和 `XrdSecztn.cc`
- **依赖库**：`XrdUtils`（仅链接此基础工具库）
- **安装位置**：`${CMAKE_INSTALL_LIBDIR}`（标准库安装路径）

### 2. XrdSecztn.cc — JWT 令牌检测工具

**主要功能**：提供 JWT 令牌的格式验证能力，用于判断传入的令牌是否符合 JWT 标准格式。

#### 代码结构

1. **匿名命名空间中的 Base64 解码器**（第 45-133 行）
   - `b64Table[]`：Base64 解码查找表
   - `DecodeBytesNeeded()`：计算解码所需的字节数
   - `DecodeUrl()`：URL 安全的 Base64 解码函数（处理 `+`、`-`、`_`、`~` 等 URL 编码字符）

2. **`XrdSecztn::isJWT()` 函数**（第 142-196 行）
   - 该函数接受一个 Base64 编码的字符串，判断其是否为有效的 JWT
   - 处理流程：
     - 跳过可能的 `Bearer%20` 前缀
     - 查找 JWT 头部（第一个 `.` 分隔的部分）
     - 对头部进行 Base64 解码
     - 验证解码结果是否为合法的 JSON 对象（以 `{` 开头、`}` 结尾）
     - 检查是否包含 `"typ": "JWT"` 键值对

#### 关键设计特点

- 使用栈分配（`alloca`）进行临时缓冲区分配，避免堆内存管理开销
- 支持 URL 安全的 Base64 变体（使用 `-` 和 `_` 替代 `+` 和 `/`）
- 只验证 JWT 头部的类型字段，不验证签名

### 3. XrdSecProtocolztn.cc — 核心协议实现

**主要功能**：实现 XRootD 安全协议接口，处理客户端和服务器端的令牌认证流程。

#### 代码结构

1. **外部头文件依赖**（第 31-67 行）
   - `XrdSec/XrdSecInterface.hh`：XRootD 安全协议基类
   - `XrdSciTokens/XrdSciTokensHelper.hh`：SciTokens 验证辅助器
   - `XrdOuc/` 系列：工具类（字符串、环境、错误处理、插件加载）
   - `XrdNet/XrdNetAddrInfo.hh`：网络地址信息
   - `XrdSys/` 系列：系统工具

2. **本地函数和全局数据**（第 85-167 行）
   - `Fatal()`：错误报告函数
   - `monotonic_time()`：单调时间获取（用于令牌过期检查）
   - `getLinkage()`：动态加载令牌验证库（`XrdSciTokensHelper`）
   - 全局变量：`expiry`（过期策略）、`tokenlib`（是否使用令牌库）

3. **`XrdSecProtocolztn` 类定义**（第 182-260 行）
   - 继承自 `XrdSecProtocol`
   - 主要成员：
     - `sthP`：SciTokens 验证辅助器指针
     - `maxTSize`：最大令牌大小（默认 4096）
     - `cont`：续传标志（用于令牌获取流程）
     - `rtGet`：运行时获取标志
     - `verJWT`：是否验证 JWT 格式
   - 内部结构体：
     - `TokenHdr`：令牌头部（8字节：`"ztn"` 标识 + 版本 + 操作码 + 保留）
     - `TokenResp`：令牌响应（头部 + 长度 + 令牌数据）

4. **客户端功能**（第 262-581 行）
   - **构造函数**：解析服务器端参数（选项+版本号、最大令牌大小）
   - **`getCredentials()`**：获取客户端凭证
     - 搜索令牌来源：`BEARER_TOKEN` 环境变量、`BEARER_TOKEN_FILE`、`XDG_RUNTIME_DIR`、`/tmp/bt_u%d`
     - 支持通过 URL 参数 `xrd.ztn` 传递凭证缓存路径
     - 若未找到令牌且允许运行时获取，向服务器发送 `SendAI` 请求
   - **`findToken()`**：在环境变量/文件中查找令牌
   - **`readToken()`**：从文件读取令牌（含权限检查）
   - **`retToken()`**：构造并返回令牌响应
   - **`Strip()`**：去除令牌首尾空白字符

5. **服务器端功能**（第 584-693 行）
   - **`Authenticate()`**：验证客户端凭证
     - 检查协议标识（`"ztn"`）
     - 处理 `SendAI` 请求（授权发行者列表）
     - 验证令牌格式和一致性
     - 调用 `sthP->Validate()` 进行令牌验证
     - 检查令牌过期时间
     - 将验证结果存入 `Entity` 结构
   - **`SendAI()`**：返回授权发行者列表（当前返回 `ENOTSUP`）

6. **初始化函数**（第 698-857 行）
   - **`XrdSecProtocolztnInit()`**：模块初始化入口（`extern "C"`）
     - 解析配置参数：`-maxsz`（最大令牌大小）、`-expiry`（过期策略）、`-tokenlib`（验证库路径）
     - 加载令牌验证插件（默认 `libXrdAccSciTokens.so`）
     - 返回服务器参数字符串
   - **`XrdSecProtocolztnObject()`**：协议对象创建入口（`extern "C"`）
     - 检查 TLS 连接要求
     - 根据模式（客户端/服务器）创建相应协议对象

## 模块依赖关系

### 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdUtils` | 基础工具库（CMakeLists.txt 中直接链接） |
| `XrdSec` | 安全协议基类（`XrdSecProtocol`） |
| `XrdSciTokens` | SciTokens 令牌验证辅助器（`XrdSciTokensHelper`） |
| `XrdOuc` | 工具类库（字符串、环境变量、错误处理、插件加载、分词器） |
| `XrdNet` | 网络地址信息（`XrdNetAddrInfo`） |
| `XrdSys` | 系统工具（错误转译、系统头文件） |
| `XrdVersion` | 版本信息宏定义 |

### 依赖该模块的其他模块

| 依赖方 | 说明 |
|--------|------|
| XRootD 安全框架 | 通过 `XrdSecProtocolztnInit` 和 `XrdSecProtocolztnObject` 两个 C 入口函数被安全框架动态加载 |
| 无直接代码依赖 | 该模块作为独立插件运行，通过动态加载机制集成，不被其他模块编译时直接引用 |

## 协议工作流程

### 客户端流程

```
1. 创建协议对象 → 解析服务器参数
2. getCredentials() → 搜索本地令牌
   a. 检查 BEARER_TOKEN 环境变量
   b. 检查 BEARER_TOKEN_FILE 指向的文件
   c. 检查 XDG_RUNTIME_DIR 目录
   d. 检查 /tmp/bt_u<uid> 文件
3. 若未找到令牌 → 可选请求服务器提供授权发行者
4. 构造 TokenResp → 发送到服务器
```

### 服务器端流程

```
1. 初始化 → 加载 SciTokens 验证库
2. 创建协议对象 → 验证 TLS 连接
3. Authenticate() → 接收客户端凭证
   a. 验证协议标识
   b. 解析令牌数据
   c. 调用 SciTokens 验证器
   d. 检查过期时间
   e. 返回验证结果
```

## 技术特点

1. **动态插件架构**：以 `MODULE` 形式构建，运行时通过 `XrdOucPinLoader` 加载
2. **TLS 强制要求**：协议要求必须使用 TLS 连接（`needTLS()` 返回 `true`）
3. **灵活的令牌来源**：支持环境变量、文件路径、目录扫描等多种令牌获取方式
4. **安全检查**：验证文件权限（仅允许所有者访问）、令牌大小限制
5. **可配置参数**：支持通过服务器配置调整最大令牌大小、过期策略、验证库路径
6. **JWT 兼容**：可选验证令牌是否符合 JWT 格式标准
