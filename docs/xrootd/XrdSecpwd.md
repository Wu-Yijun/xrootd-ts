# XrdSecpwd 模块分析报告

## 1. 模块概述

XrdSecpwd 是 XRootD 框架中的**基于密码的安全协议插件**（Protocol Identifier: `"pwd"`），负责在 XRootD 客户端与服务器之间提供基于密码的认证和会话密钥协商。

该模块同时包含两个部分：
- **安全协议库**（动态加载的 MODULE 插件）：实现完整的密码认证握手流程
- **管理工具**（`xrdpwdadmin` 命令行可执行文件）：用于管理密码文件、自动登录文件和服务器公钥文件

## 2. 文件清单

| 文件名 | 作用描述 |
|--------|----------|
| `CMakeLists.txt` | 构建配置：编译 XrdSecpwd 插件库和 xrdpwdadmin 管理工具 |
| `XrdSecProtocolpwd.hh` | 核心头文件：定义密码协议类 `XrdSecProtocolpwd`、状态枚举、错误码、配置选项等 |
| `XrdSecProtocolpwd.cc` | 核心实现：协议初始化、客户端/服务端认证握手、凭证校验、加密通信等全部逻辑（约 3000 行） |
| `XrdSecpwdPlatform.hh` | 平台适配头文件：处理不同操作系统上 `crypt()` 函数和 shadow 密码的兼容性 |
| `XrdSecpwdTrace.hh` | 调试追踪宏定义：定义 `TRACE`、`DEBUG`、`QTRACE` 等调试输出宏 |
| `XrdSecpwdSrvAdmin.cc` | 管理工具源码：`xrdpwdadmin` 命令行程序，用于创建/修改/浏览各类密码文件（约 2465 行） |

## 3. 重要文件详细结构分析

### 3.1 XrdSecProtocolpwd.hh — 协议头文件

#### 主要枚举类型

| 枚举名 | 说明 |
|--------|------|
| `kpwdStatus` | 消息状态码：error(-1), ok(0), more(1) |
| `kpwdAutoreg` | 自动注册模式：none/users/all |
| `kpwdUpdate` | 客户端自动登录更新模式：none/remove/all |
| `kpwdCredsInput` | 凭证输入来源：undefined/prompt/exact/wildcard |
| `kpwdCredType` | 凭证类型（12种）：normal, onetime, old, new, autoreg, crypt, afs 等 |
| `kpwdCredsActions` | 凭证操作：check, checkold, cache, checkcache |
| `kpwdClientSteps` | 客户端握手步骤（1000-1006）：normal, verifysrv, signedrtag, creds, autoreg, failureack |
| `kpwdServerSteps` | 服务端握手步骤（2000-2006）：init, credsreq, rtag, signedrtag, newpuk, puk, failure |
| `kpwdErrors` | 错误码（10000-10036）：36种不同的错误类型 |

#### 核心类

- **`pwdOptions`**：配置选项类，包含 debug、mode、areg、upwd、alog、verisrv、vericlnt、syspwd、lifecreds 等所有协议参数
- **`pwdHSVars`**：握手变量类，存储每次认证过程中的临时状态（迭代次数、加密模块、用户名、密码标签、会话密钥等）
- **`XrdSecProtocolpwd`**：继承自 `XrdSecProtocol`，是协议的核心实现类

#### XrdSecProtocolpwd 类关键方法

| 方法 | 说明 |
|------|------|
| `Authenticate()` | 服务端：接收客户端凭证并验证 |
| `getCredentials()` | 客户端：生成并发送凭证 |
| `Init()` | 静态方法：一次性配置协议参数 |
| `ParseClientInput()` | 服务端解析客户端输入 |
| `ParseServerInput()` | 客户端解析服务端输入 |
| `CheckCreds()` | 验证密码凭证（支持标准哈希和 crypt） |
| `CheckCredsAFS()` | AFS 凭证验证（未实现） |
| `SaveCreds()` | 保存验证通过的凭证 |
| `ExportCreds()` | 导出客户端凭证到文件 |
| `QueryCreds()` | 客户端查询凭证（支持环境变量、自动登录文件、交互式提示） |
| `QueryUser()` | 服务端查询用户信息（admin文件、用户文件、系统密码） |
| `QueryNetRc()` | 查询 .netrc 文件 |
| `AddSerialized()` | 序列化并加密通信数据 |
| `DoubleHash()` | 双重哈希操作 |

### 3.2 XrdSecProtocolpwd.cc — 核心实现

#### 静态数据

- **文件引用**：FileAdmin（管理密码文件）、FileExpCreds（导出凭证文件）、FileUser（用户密码文件）、FileCrypt（crypt哈希文件）、FileSrvPuk（服务器公钥文件）
- **加密模块**：最多支持 `XrdCryptoMax`(10) 个加密工厂，包括引用密钥和本地密钥
- **缓存**：cacheAdmin, cacheSrvPuk, cacheUser, cacheAlog 四个文件缓存

#### 协议初始化（`XrdSecProtocolpwdInit`）

通过 C 导出函数提供，分为：
- **客户端模式** (`mode == 'c'`)：从环境变量读取配置（`XrdSecDEBUG`, `XrdSecPWDVERIFYSRV`, `XrdSecPWDSRVPUK`, `XrdSecPWDAUTOLOG`, `XrdSecPWDALOGFILE` 等）
- **服务端模式** (`mode == 's'`)：从命令行参数解析配置（`-upwd:`, `-a:`, `-vc:`, `-dir:`, `-c:`, `-syspwd`, `-lf:`, `-maxfail:`, `-keepcreds`, `-expcreds:`, `-expfmt:` 等）

#### 认证握手流程

**客户端流程 (`getCredentials`)**:
1. 解析服务端参数，确定加密模块
2. 生成会话密钥并发送公钥部分
3. 可选验证服务端公钥所有权（VeriSrv）
4. 发送用户名和密码凭证（从自动登录文件或交互式提示获取）
5. 处理凭证过期/密码更改请求
6. 序列化并加密所有数据发送

**服务端流程 (`Authenticate`)**:
1. 解码客户端缓冲区，验证协议标识
2. 查询用户信息（admin文件 -> 用户文件 -> 系统密码）
3. 验证凭证（支持标准哈希、crypt、AFS 格式）
4. 处理自动注册请求
5. 可选要求客户端签名随机挑战（VeriClnt）
6. 管理凭证生命周期和失败计数

#### 凭证验证（`CheckCreds`）

- **标准密码**：使用 DoubleHash 进行双重哈希后与存储的哈希比较
- **crypt 类密码**：使用系统 `crypt()` 函数验证
- **AFS 密码**：接口已定义但未实现

#### 导出凭证（`ExportCreds`）

支持四种格式：
- `PFile`：XrdSutPFEntry 文件格式
- `hex`：十六进制编码
- `raw`：原始格式含关键字
- `raw/nokeyword`：原始格式无关键字

### 3.3 XrdSecpwdSrvAdmin.cc — 管理工具

`xrdpwdadmin` 是一个交互式命令行工具，支持四种操作模式：

| 模式 | 说明 | 默认文件路径 |
|------|------|-------------|
| `admin` | 管理服务器密码文件 | `~/.xrd/pwdadmin` |
| `user` | 管理用户密码文件 | `~/.xrd/pwduser` |
| `netrc` | 管理自动登录文件 | `~/.xrd/pwdnetrc` |
| `srvpuk` | 管理服务器公钥文件 | `~/.xrd/pwdsrvpuk` |

**支持的操作**：
- `add` — 添加条目
- `update` — 更新条目（等同 add -force）
- `read` — 读取条目信息
- `remove` — 删除条目
- `disable` — 禁用条目
- `copy` — 复制条目
- `trim` — 清理文件
- `browse` — 浏览文件内容

**特殊管理功能**：
- 设置服务器唯一 ID（`-srvID`）
- 设置联系邮箱（`-email`）
- 设置主机名（`-host`）
- 更换服务器公钥（`-changepuk`）
- 导出公钥（`-exportpuk`）
- 导入外部密码/密钥文件（`-import`）

## 4. 模块依赖关系

### 4.1 XrdSecpwd 依赖的模块

| 模块 | 用途 |
|------|------|
| **XrdCrypto** | 加密工厂（`XrdCryptoFactory`）、加密操作（`XrdCryptoCipher`）、哈希函数 |
| **XrdSut** | 持久化文件操作（`XrdSutPFile`, `XrdSutPFCache`, `XrdSutPFEntry`）、缓冲区（`XrdSutBuffer`, `XrdSutBucket`）、随机数（`XrdSutRndm`） |
| **XrdSec** | 安全协议基类（`XrdSecProtocol`, `XrdSecCredentials`, `XrdSecParameters`） |
| **XrdOuc** | 字符串（`XrdOucString`）、错误处理（`XrdOucErrInfo`）、跟踪（`XrdOucTrace`）、标记器（`XrdOucTokenizer`） |
| **XrdSys** | 系统工具：互斥锁（`XrdSysPthread`）、日志（`XrdSysLogger`, `XrdSysError`）、权限（`XrdSysPriv`）、密码查询（`XrdSysPwd`） |
| **XrdNet** | 网络地址信息（`XrdNetAddrInfo`） |
| **系统库** | `crypt.h`（Linux）、`shadow.h`（shadow密码）、`pwd.h`（用户信息） |

### 4.2 依赖 XrdSecpwd 的模块

根据 CMakeLists.txt 分析，`XrdSecpwd` 编译为 **MODULE**（动态加载插件），它通过 `add_dependencies(plugins ...)` 被注册到 XRootD 的插件系统中。在运行时由以下模块加载：

- **XrdSec** 安全框架（通过 `XrdSecProtocolpwdInit` 和 `XrdSecProtocolpwdObject` 导出符号加载）
- **xrootd 守护进程**（`XrdXrootd`）在需要密码认证时加载此插件
- **xrdcp / xrdfs 等客户端工具**（`XrdCl`）在连接到需要密码认证的服务器时加载此插件

此外，`xrdpwdadmin` 可执行文件依赖 `XrdCrypto` 和 `XrdUtils`。

## 5. 安全特性

- **双向认证**：支持服务端验证（VeriSrv）和客户端验证（VeriClnt，包括时间戳和随机挑战）
- **会话密钥协商**：通过加密工厂生成会话密钥，确保通信安全
- **自动注册**：支持可配置级别的用户自动注册（none/users/all）
- **凭证管理**：支持凭证过期、密码更改、失败计数锁定
- **多加密模块**：支持同时配置多个加密模块（默认 ssl）
- **系统密码集成**：可选集成系统密码（crypt/shadow）和 AFS 密码（部分）
- **凭证导出**：支持将凭证导出为多种格式用于自动化场景

## 6. 文件存储结构

所有密码文件使用 `XrdSutPFile` 格式（一种键值对持久化文件），每个条目包含：
- 名称标签（tag）
- 状态（ok/disabled/allowed/expired/onetime/crypt/special）
- 计数器（用于失败计数）
- 最后修改时间
- 最多 4 个缓冲区（用于存储 salt、哈希、密钥等）

典型路径：
- 服务端：`$HOME/.xrd/pwdadmin`（管理密码）、`$HOME/.xrd/pwdsrvpuk`（服务器公钥）
- 客户端：`$HOME/.xrd/pwdnetrc`（自动登录）、`$HOME/.xrd/pwdsrvpuk`（已知服务器公钥）
- 用户级：`$HOME/.xrd/pwduser`（用户密码）、`$HOME/.xrootdpass`（crypt哈希）
