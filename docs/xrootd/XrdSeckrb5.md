# XrdSeckrb5 模块分析

## 1. 模块概述

**XrdSeckrb5** 是 XRootD 安全框架中的一个**可插拔认证插件**，实现了基于 **Kerberos 5** 协议的安全认证机制。该模块允许 XRootD 客户端和服务器之间通过 Kerberos 票据进行相互身份验证，支持标准认证和票据转发（forwardable ticket）功能。

该模块以 **动态共享库（MODULE）** 形式构建，在运行时由 XrdSec 安全框架动态加载。

## 2. 文件列表及说明

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | CMake 构建配置，定义模块编译、链接和安装规则 |
| `XrdSecProtocolkrb5.cc` | 核心实现文件，包含 Kerberos 5 认证协议的完整客户端和服务端逻辑 |

## 3. 文件结构分析

### 3.1 CMakeLists.txt

```cmake
if(NOT BUILD_KRB5)
  return()
endif()

set(XrdSeckrb5 XrdSeckrb5-${PLUGIN_VERSION})
add_library(${XrdSeckrb5} MODULE XrdSecProtocolkrb5.cc)
target_link_libraries(${XrdSeckrb5} PRIVATE XrdUtils ${KERBEROS5_LIBRARIES})
target_include_directories(${XrdSeckrb5} PRIVATE ${KERBEROS5_INCLUDE_DIR})
install(TARGETS ${XrdSeckrb5} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
```

**要点：**
- 通过 `BUILD_KRB5` 开关控制是否编译（由 CMake `ENABLE_KRB5` 选项和 Kerberos5 库是否找到共同决定）
- 编译为 `MODULE` 类型共享库，支持运行时动态加载
- 链接依赖：`XrdUtils`（XRootD 工具库）+ `Kerberos5` 系统库
- 版本号通过 `PLUGIN_VERSION` 追加

### 3.2 XrdSecProtocolkrb5.cc（1077 行）

#### 类定义（第 91-175 行）

定义了 `XrdSecProtocolkrb5` 类，继承自 `XrdSecProtocol` 基类（来自 XrdSec 模块）。核心接口：

| 方法 | 作用 |
|------|------|
| `Authenticate()` | 服务端验证客户端凭据 |
| `getCredentials()` | 客户端生成认证凭据 |
| `Init()` | 静态初始化方法（设置 Kerberos 上下文、keytab 等） |
| `Delete()` | 资源清理 |

**关键成员变量：**
- `krb_context` / `krb_client_context` — 服务端/客户端的 Kerberos 上下文
- `krb_ccache` / `krb_client_ccache` — 服务端/客户端凭据缓存
- `krb_keytab` — 服务端 keytab（用于验证客户端票据）
- `krb_principal` — 服务端的 Kerberos 主体名
- `AuthContext` / `AuthClientContext` — 认证上下文
- `Ticket` — 客户端认证后的票据
- `Step` — 认证步骤计数器（支持多步握手）

#### 核心功能流程

**客户端流程 (`getCredentials()`, 第 218-407 行)：**
1. 初始化 Kerberos 客户端上下文
2. 设置凭据缓存（支持 `xrd.k5ccname` URL 参数和 `KRB5CCNAME` 环境变量）
3. 获取服务票据（`get_krbCreds()`）
4. 如果需要转发票据（`-exptkn` 模式），在第二步调用 `get_krbFwdCreds()` 生成转发 TGT
5. 使用 `krb5_mk_req_extended()` 生成认证请求消息
6. 返回包含协议标识 `"krb5"` + Kerberos 认证数据的凭据

**服务端流程 (`Authenticate()`, 第 416-559 行)：
1. 验证协议标识是否为 `"krb5"`
2. 第一步：使用 `krb5_rd_req()` 验证客户端凭据，提取客户端主体名
3. 可选 IP 地址匹配检查（`XrdSecNOIPCHK` 标志控制）
4. 如果启用票据转发（`XrdSecEXPTKN`），请求客户端发送转发票据
5. 第二步：调用 `exp_krbTkn()` 将转发凭据导出到本地票据缓存文件

**初始化流程 (`XrdSecProtocolkrb5Init()`, 第 902-1023 行)：
- 解析参数：`[<keytab>] [-ipchk] [-exptkn[:filetemplate]] <principal>`
- 支持 `<host>` 关键字在主体名中的展开
- 初始化 Kerberos 上下文、keytab、票据缓存

**票据转发 (`exp_krbTkn()`, 第 769-873 行)：
- 接收客户端转发的凭据
- 导出到本地票据缓存文件（模板默认 `/tmp/krb5cc_<uid>`，支持 `<user>`、`<uid>` 占位符）
- 设置文件权限为 0600

#### 导出接口（C 接口，第 900-1077 行）

| 导出函数 | 作用 |
|----------|------|
| `XrdSecProtocolkrb5Init()` | 插件初始化入口，由 XrdSec 框架调用 |
| `XrdSecProtocolkrb5Object()` | 创建协议对象实例，由 XrdSec 框架调用 |
| `XrdVERSIONINFO(...)` | 版本信息宏，用于插件版本校验 |

## 4. 依赖关系

### 4.1 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| **XrdSec** (`XrdSecInterface.hh`) | 提供 `XrdSecProtocol` 基类、`XrdSecCredentials`、`XrdSecParameters` 等安全框架核心接口 |
| **XrdNet** (`XrdNetAddrInfo.hh`, `XrdNetUtils.hh`) | 网络地址处理（获取主机名、处理 IPv4/IPv6 地址） |
| **XrdOuc** (`XrdOucErrInfo.hh`, `XrdOucEnv.hh`, `XrdOucTokenizer.hh`) | 错误信息处理、环境变量、参数解析 |
| **XrdSys** (`XrdSysHeaders.hh`, `XrdSysPthread.hh`, `XrdSysPwd.hh`) | 系统工具（互斥锁、密码数据库封装） |
| **XrdUtils** (通过 CMakeLists.txt 链接) | XRootD 通用工具库 |
| **Kerberos5 系统库** (`krb5.h`, `com_err.h`) | Kerberos 5 协议实现（外部依赖） |

### 4.2 依赖该模块的其他模块

| 依赖方 | 说明 |
|--------|------|
| **XrdSec 框架** (`XrdSecServer`, `XrdSecClient`) | 在运行时通过 `dlopen` 动态加载本插件，调用其导出的 `XrdSecProtocolkrb5Init` 和 `XrdSecProtocolkrb5Object` 接口 |
| **XrdXrootd 服务器** | 当安全配置指定使用 `krb5` 协议时，XRootD 服务器会触发加载此插件 |
| **XrdCl 客户端** | 当客户端连接到要求 Kerberos 认证的服务器时，动态加载此插件 |

> 注：由于插件机制是运行时动态加载，源码层面**不存在直接的 `#include` 引用**关系。依赖关系通过 XrdSec 框架的插件加载机制（`XrdSecLoadSecurity`）和 Kerberos5 协议标识 `"krb5"` 隐式关联。

## 5. 编译控制

构建由以下 CMake 变量链控制：

```
ENABLE_KRB5 (用户选项)
    ↓
find_package(Kerberos5)
    ↓
KERBEROS5_FOUND → BUILD_KRB5
    ↓
XrdSeckrb5/CMakeLists.txt 中的 if(NOT BUILD_KRB5) return()
```

在 `cmake/XRootDFindLibs.cmake:33-43` 中定义了查找逻辑。
在 `cmake/XRootDSummary.cmake:19` 中输出构建状态。

## 6. 安全特性

- 支持 **IP 地址验证**（默认启用，可通过 `-ipchk` 关闭）
- 支持 **票据转发**（`-exptkn` 选项），允许将客户端的 TGT 转发到服务端
- 支持 **票据自动重新获取**（`XrdSecKRB5INITTKN` 环境变量）
- 凭据缓存文件权限设置为 **0600**（仅所有者可读写）
- 使用 **重放缓存**（replay cache）防止重放攻击
- 支持 IPv4 和 IPv6 地址绑定
