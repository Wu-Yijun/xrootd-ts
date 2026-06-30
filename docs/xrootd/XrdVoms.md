# XrdVoms 模块分析

## 模块概述

`XrdVoms` 是 XRootD 框架中的一个 **可插拔安全模块**，负责从 X.509 代理证书中提取 **VOMS（Virtual Organization Membership Service）** 授权信息，并将其填充到 XRootD 安全实体（`XrdSecEntity`）中。

**核心功能：**
1. 从客户端的 X.509 证书链中解析 VOMS 扩展属性（FQAN — Fully Qualified Attribute Name）
2. 将解析出的 VO 名称、组（group）、角色（role）、背书（endorsements）写入会话安全实体
3. 支持通过 **voms-mapfile** 将 FQAN 映射为 Unix 用户名，供文件系统做授权决策
4. 同时提供 GSI 协议和 HTTP 协议两条接入路径

## 文件清单

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | 构建配置：编译为动态插件模块，链接 VOMS 和 OpenSSL 库，并创建 GSI/HTTP 两个符号链接 |
| `README.md` | 用户文档：描述 voms-mapfile 的配置方法、文件格式和 FQAN 匹配规则 |
| `XrdVoms.hh` | 公共头文件：定义 `Voms_x509_in_t` 结构体，用于 STACK_OF(X509) 格式的输入 |
| `XrdVomsFun.hh` | 核心类 `XrdVomsFun` 的声明：包含 VOMS 初始化和提取的全部接口与成员 |
| `XrdVomsFun.cc` | `XrdVomsFun` 的实现：证书解析、VOMS 扩展提取、组/角色/VO 的格式化输出、mapfile 映射 |
| `XrdVomsgsi.cc` | GSI 协议接入层：导出 `XrdSecgsiVOMSFun` / `XrdSecgsiVOMSInit` C 接口，供 XrdSecgsi 动态加载 |
| `XrdVomsHttp.cc` | HTTP 协议接入层：实现 `XrdHttpSecXtractor` 接口，从 SSL 连接中提取 VOMS 信息 |
| `XrdVomsMapfile.hh` | `XrdVomsMapfile` 类声明：voms-mapfile 的解析、匹配、自动刷新逻辑 |
| `XrdVomsMapfile.cc` | `XrdVomsMapfile` 的实现：mapfile 解析、FQAN 通配符匹配、后台线程定期重载 |
| `XrdVomsTrace.hh` | 调试宏定义：`PRINT` / `DEBUG` / `EPNAME` 宏，控制调试输出 |

## 详细结构分析

### 1. 核心数据流

```
客户端证书 → XrdVomsFun::VOMSFun() → VOMS库解析FQAN → 填充XrdSecEntity字段
                                                    → XrdVomsMapfile::Apply() → 映射为Unix用户名
```

### 2. `XrdVomsFun` — 核心提取引擎

**构造与初始化：**
- 构造函数接受 `XrdSysError` 引用用于日志输出
- `VOMSInit()` 从配置字符串中解析选项，包括：
  - `certfmt`：证书格式（raw / pem / x509），默认 raw
  - `grpopt`：组选择策略（useall / usefirst / uselast）
  - `grps`：指定需要提取的组列表
  - `vos`：指定需要提取的 VO 列表
  - `grpfmt` / `rolefmt` / `vofmt`：输出格式模板，支持 `<g>` `<r>` `<vo>` `<an>` 占位符

**主函数 `VOMSFun()`：**
1. 根据证书格式从 `XrdSecEntity::creds` 中提取代理证书和证书链
2. 调用 VOMS 库的 `vomsdata::Retrieve()` 解析 VOMS 扩展
3. 遍历所有 VO 和组，按配置的过滤/选择策略收集信息
4. 将结果写入 `XrdSecEntity` 的 `vorg`、`grps`、`role`、`endorsements` 字段
5. 调用 `FmtReplace()` 应用格式化模板
6. 调用 `XrdVomsMapfile::Apply()` 执行 mapfile 映射

**支持的证书格式：**
| 格式 | 枚举值 | 来源 |
|------|--------|------|
| `gCertRaw` | 0 | XrdCryptoX509Chain（XRootD 内部格式） |
| `gCertPEM` | 1 | PEM 编码的证书数据 |
| `gCertX509` | 2 | STACK_OF(X509)（用于 HTTP 接入） |

### 3. `XrdVomsMapfile` — FQAN 到用户名的映射

**设计要点：**
- 单例模式（`std::unique_ptr<XrdVomsMapfile> mapper`）
- 使用 `std::shared_ptr<const std::vector<MapfileEntry>>` 实现无锁读、原子替换
- 后台维护线程每 30 秒检查 mapfile 的 ctime，有变化时自动重载

**Mapfile 格式：**
```
"/cms/Role=production/Capability=NULL" cms_prod_user
"/atlas/*/Role=pilot/Capability=NULL" atlas_pilot
```

**匹配规则：**
- 支持路径通配符（`*`）
- 末尾 `/*` 匹配任意后缀
- 路径中间的 `*` 匹配该层级任意字符
- 支持转义序列（`\'` `\"` `\\` `\/` `\f` `\n` `\r` `\t`）
- 更具体的条目不能匹配更泛化的 FQAN

**映射优先级：**
1. grid-mapfile 中的显式条目（通过 `gridmap.name` 属性判断）
2. voms-mapfile 中的匹配条目
3. grid-mapfile 自动生成的默认名称

### 4. 协议接入层

**GSI 接入（`XrdVomsgsi.cc`）：**
- 导出两个 C 接口供 `XrdSecgsi` 动态加载：
  - `XrdSecgsiVOMSInit(const char *cfg)` — 初始化，返回证书格式代码
  - `XrdSecgsiVOMSFun(XrdSecEntity &ent)` — 执行 VOMS 提取

**HTTP 接入（`XrdVomsHttp.cc`）：**
- 实现 `XrdHttpSecXtractor` 接口的 `GetSecData()` 方法
- 从 `SSL *` 对象中获取对端证书和证书链
- 构造 `Voms_x509_in_t` 结构后调用 `XrdVomsFun::VOMSFun()`
- 成功时将协议标识设为 `"gsi"`

### 5. 调试与日志

`XrdVomsTrace.hh` 定义了三个宏：
- `PRINT(y)` — 基本日志输出（gDebug >= 1）
- `DEBUG(y)` — 详细调试输出（gDebug >= 2）
- `EPNAME(x)` — 定义当前函数名（用于日志前缀）

## 依赖关系

### 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| **libvomsapi** (VOMS) | VOMS 库：解析 X.509 证书中的 VOMS 扩展 |
| **OpenSSL** (libssl/libcrypto) | X.509 证书处理、BIO 内存操作 |
| **XrdUtils** | XRootD 通用工具库（CMake 链接） |
| **XrdOuc** | `XrdOucString`、`XrdOucHash`、`XrdOucStream`、`XrdOucEnv` 等基础设施 |
| **XrdSys** | `XrdSysError`、`XrdSysLogger`、`XrdSysPthread`、`XrdSysFD` 等系统抽象 |
| **XrdSec** | `XrdSecEntity`、`XrdSecEntityAttr` 安全实体定义 |
| **XrdCrypto** | `XrdCryptoX509`、`XrdCryptoX509Chain` 证书链处理（raw 格式） |
| **XrdHttp** | `XrdHttpSecXtractor` HTTP 安全提取器接口 |
| **XrdSecgsi** | 通过符号链接提供 `XrdSecgsiVOMSFun` / `XrdSecgsiVOMSInit` |

### 依赖该模块的其他模块

| 依赖方 | 加载方式 |
|--------|----------|
| **XrdSecgsi** (`XrdSecProtocolgsi.cc`) | 动态加载 `libXrdSecgsiVOMS.so`，解析 `XrdSecgsiVOMSFun` 和 `XrdSecgsiVOMSInit` 符号 |
| **XrdHttp** (`XrdHttpProtocol.cc`) | 动态加载 `libXrdHttpVOMS.so`，解析 `XrdHttpGetSecXtractor` 符号 |

> 注：`libXrdSecgsiVOMS.so` 和 `libXrdHttpVOMS.so` 均为 `libXrdVoms.so` 的符号链接，实际是同一个动态库。

## 构建说明

- 由 `ENABLE_VOMS` CMake 选项控制是否编译
- 需要系统安装 VOMS 开发库（`find_package(VOMS)`）
- 编译产物为 `libXrdVoms-<version>.so` 模块库
- 安装时自动创建 `libXrdSecgsiVOMS-<version>.so` 和 `libXrdHttpVOMS-<version>.so` 符号链接

## 配置示例

```bash
# 启用 VOMS 映射
voms.mapfile /etc/xrootd/voms-mapfile

# 启用调试日志
voms.trace debug warning
```
