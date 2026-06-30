# XrdSecunix 模块分析

## 模块概述

XrdSecunix 是 XRootD 安全框架中的一个**认证协议插件**，提供基于 Unix 用户/组身份的简单认证机制。该模块以动态库（MODULE）形式构建，遵循 XRootD 安全协议插件的统一接口规范（`XrdSecProtocol`）。

**核心功能**：
- 客户端：获取当前进程的有效用户（euid）和有效组（egid）信息，封装为凭证
- 服务器端：解析客户端发来的 Unix 凭证，提取用户名和组名，填充到 `Entity` 中供授权决策使用

**协议标识**：`"unix"`

**安全级别**：这是 XRootD 中**最低安全级别**的认证协议，仅传递 Unix 用户/组名称，不包含任何加密或挑战-响应机制。通常用于可信内部网络环境。

---

## 文件结构

| 文件名 | 说明 |
|--------|------|
| `CMakeLists.txt` | CMake 构建配置，定义插件目标和依赖关系 |
| `XrdSecProtocolunix.cc` | 安全协议的完整实现，包含客户端和服务器端逻辑 |

该模块仅由一个源文件实现，没有独立的头文件（头文件信息内联在 `.cc` 文件中）。

---

## 构建配置（CMakeLists.txt）

```cmake
set(XrdSecunix XrdSecunix-${PLUGIN_VERSION})
add_library(${XrdSecunix} MODULE XrdSecProtocolunix.cc)
target_link_libraries(${XrdSecunix} PRIVATE XrdUtils)
add_dependencies(plugins ${XrdSecunix})
install(TARGETS ${XrdSecunix} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
```

- **构建产物**：`libXrdSecunix-{版本号}.so`（动态模块库）
- **直接依赖**：仅链接 `XrdUtils`
- **安装路径**：`${CMAKE_INSTALL_LIBDIR}`（通常为 `lib64`）
- **构建时依赖**：属于 `plugins` 目标的一部分

---

## 核心类：XrdSecProtocolunix

继承自 `XrdSecProtocol`（定义于 `XrdSec/XrdSecInterface.hh`），实现 Unix 认证协议。

### 类成员

| 成员 | 类型 | 说明 |
|------|------|------|
| `epAddr` | `XrdNetAddrInfo` | 端点地址信息 |
| `credBuff` | `char*` | 服务器端凭证缓冲区 |

### 构造函数

```cpp
XrdSecProtocolunix(const char *hname, XrdNetAddrInfo &endPoint)
```
- 将协议名称设为 `"unix"`
- 复制主机名到 `Entity.host`
- 设置 `Entity.name = "?"`（默认未知）
- 存储端点地址引用

### 析构函数

释放 `credBuff` 和 `Entity.host` 的内存。

---

## 关键方法

### 客户端方法

#### `getCredentials()`

**用途**：生成发送给服务器的认证凭证。

**实现逻辑**：
1. 在缓冲区前 5 字节写入协议标识 `"unix\0"`
2. 通过 `XrdOucUtils::UserName(geteuid())` 获取当前有效用户名
3. 通过 `XrdOucUtils::GroupName(getegid())` 获取当前有效组名
4. 格式为 `"unix\0username group"`，用空格分隔
5. 分配新缓冲区，封装为 `XrdSecCredentials` 返回

**返回格式**：
```
+--------+----------+--------+
| unix\0 | username |  group |
+--------+----------+--------+
```

### 服务器端方法

#### `Authenticate()`

**用途**：验证客户端提交的凭证。

**实现逻辑**：
1. **空凭证处理**：如果 `cred->size <= 4` 或 `cred->buffer` 为空，使用主机名作为客户端标识，协议标记为 `"host"`
2. **协议验证**：检查凭证前 4 字节是否为 `"unix"`，不匹配则报错返回 `-1`（`EINVAL`）
3. **用户名提取**：跳过协议标识（5 字节），解析第一个空格前的字符串作为 `Entity.name`
4. **组名提取**：解析下一个非空格字段作为 `Entity.grps`
5. 成功返回 `0`

**错误处理**：
- 协议不匹配时，通过 `XrdOucErrInfo::setErrInfo()` 设置错误信息，或输出到 `stderr`

---

## 插件接口函数

### `XrdSecProtocolunixInit()`

```cpp
extern "C" char *XrdSecProtocolunixInit(const char mode, const char *parms, XrdOucErrInfo *erp)
```

- 插件初始化入口点
- 返回空字符串（无需特殊初始化）
- 模式参数和参数字符串均被忽略

### `XrdSecProtocolunixObject()`

```cpp
extern "C" XrdSecProtocol *XrdSecProtocolunixObject(
    const char mode, const char *hostname, XrdNetAddrInfo &endPoint,
    const char *parms, XrdOucErrInfo *erp)
```

- 工厂函数，创建 `XrdSecProtocolunix` 实例
- 内存不足时通过 `XrdOucErrInfo` 报告 `ENOMEM` 错误
- 使用 `XrdVERSIONINFO` 宏注册版本信息

---

## 依赖关系

### 该模块依赖的其他模块

| 模块 | 头文件 | 用途 |
|------|--------|------|
| **XrdSec** | `XrdSecInterface.hh` | 安全协议基类 `XrdSecProtocol`、`XrdSecCredentials`、`XrdSecParameters` |
| **XrdNet** | `XrdNetAddrInfo.hh` | 网络地址信息类 |
| **XrdOuc** | `XrdOucErrInfo.hh`, `XrdOucUtils.hh` | 错误处理和工具函数（用户名/组名获取） |
| **XrdSys** | `XrdSysHeaders.hh`, `XrdSysPthread.hh` | 系统头文件和线程支持 |
| **XrdUtils** | `XrdVersion.hh` | 版本宏定义（CMake 链接） |

### 依赖该模块的其他模块

| 模块/文件 | 引用方式 | 说明 |
|-----------|----------|------|
| `XrdVersionPlugin.hh` | 版本规则定义 | 注册 `XrdSecProtocolunixInit` 和 `XrdSecProtocolunixObject` 的版本兼容规则 |
| `XrdClDefaultEnv.cc` | 库引用 | 客户端默认环境配置中引用 `libXrdSecunix.so` |
| `src/CMakeLists.txt` | `add_subdirectory()` | 构建系统集成 |
| `xrootd.spec` | RPM 打包 | 发行包中包含 `libXrdSecunix-6.so` |
| `debian/xrootd-plugins.install` | DEB 打包 | Debian 包中包含该库 |

---

## 协议交互流程

```
客户端                                         服务器端
  |                                               |
  |  1. getCredentials()                          |
  |     → 获取 euid/egid                         |
  |     → 返回 "unix\0user group"                 |
  |                                               |
  |  ──────── 发送凭证 (XrdSecCredentials) ────→  |
  |                                               |
  |                               2. Authenticate() |
  |                                  → 验证协议标识 |
  |                                  → 解析用户名   |
  |                                  → 解析组名     |
  |                                  → 填充 Entity  |
  |                                               |
  |  ←─────── 返回结果 (int status) ──────────    |
  |                                               |
```

---

## 安全性说明

1. **无加密**：用户名和组名以明文传输
2. **无挑战-响应**：不防重放攻击
3. **依赖客户端诚实性**：客户端自行报告身份，服务器无法独立验证
4. **适用场景**：仅限于可信网络中的内部认证，不适用于跨域或不可信环境
5. **替代方案**：生产环境建议使用 `XrdSecgsi`（GSI/Grid）或 `XrdSecsss`（共享密钥）等安全级别更高的协议

---

## 文件依赖图

```
XrdSecunix/
├── CMakeLists.txt          ← 构建配置
└── XrdSecProtocolunix.cc   ← 核心实现
    ├── XrdSec/XrdSecInterface.hh    (基类)
    ├── XrdNet/XrdNetAddrInfo.hh     (地址信息)
    ├── XrdOuc/XrdOucErrInfo.hh      (错误处理)
    ├── XrdOuc/XrdOucUtils.hh        (工具函数)
    ├── XrdSys/XrdSysHeaders.hh      (系统头文件)
    ├── XrdSys/XrdSysPthread.hh      (线程支持)
    └── XrdVersion.hh                (版本宏)
```
