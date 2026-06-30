# XrdNet 模块分析

## 1. 模块概述

XrdNet 是 XRootD 项目中的核心网络通信模块，提供了完整的 TCP/UDP 网络连接管理功能。该模块封装了底层 socket 操作，提供高级别的网络接口抽象，支持 IPv4/IPv6 双栈协议、主机名解析、网络地址管理、安全控制、性能监控等功能。

## 2. 文件列表与功能说明

| 文件名 | 功能描述 |
|--------|----------|
| `XrdNet.cc/hh` | 核心网络类，提供 TCP/UDP 连接的 Accept、Bind、Connect、Relay 操作 |
| `XrdNetAddr.cc/hh` | 网络地址操作类，继承自 XrdNetAddrInfo，提供地址设置、解析、格式化功能 |
| `XrdNetAddrInfo.cc/hh` | 网络地址信息基类，提供只读访问的地址信息，包括 IP 地址、主机名、端口等 |
| `XrdNetBuffer.cc/hh` | 网络缓冲区管理，提供缓冲区分配、回收和缓冲区队列管理 |
| `XrdNetCache.cc/hh` | DNS 缓存实现，使用哈希表存储地址-主机名映射关系 |
| `XrdNetCmsNotify.cc/hh` | CMS 通知机制，用于向 CMS 发送文件状态通知（Gone/Have） |
| `XrdNetConnect.cc/hh` | 网络连接工具类，提供带超时的 connect() 系统调用封装 |
| `XrdNetIdentity.cc/hh` | 主机身份管理，提供获取和设置主机完全限定域名（FQN）的功能 |
| `XrdNetIF.cc/hh` | 网络接口管理，处理主机网络接口的获取、编码、解码和路由 |
| `XrdNetMsg.cc/hh` | UDP 消息发送类，提供向端点发送 UDP 数据报的功能 |
| `XrdNetOpts.hh` | 网络选项常量定义，包含各种 socket 选项标志（TCP_NODELAY、SO_KEEPALIVE 等） |
| `XrdNetPeer.hh` | 对端信息结构体，包含文件描述符、IP 地址、主机名和 UDP 缓冲区 |
| `XrdNetPMark.cc/hh` | 性能标记基类，用于性能监控和数据传输追踪 |
| `XrdNetPMarkCfg.cc/hh` | 性能标记配置类，处理性能标记的配置解析和初始化 |
| `XrdNetPMarkFF.cc/hh` | 性能标记文件类，用于生成性能标记的文件输出 |
| `XrdNetRefresh.cc/hh` | DNS 刷新任务，周期性地重新解析 DNS 以检测地址变化 |
| `XrdNetRegistry.cc/hh` | 主机名注册表，支持伪主机名注册和解析 |
| `XrdNetSecurity.cc/hh` | 网络安全控制，实现基于主机名/IP 的访问授权 |
| `XrdNetSockAddr.hh` | Socket 地址联合体，定义最小的 IPv4/IPv6 地址结构 |
| `XrdNetSocket.cc/hh` | Socket 操作封装类，提供 socket 创建、绑定、监听、连接等操作 |
| `XrdNetUtils.cc/hh` | 网络工具函数集，提供地址比较、编码/解码、格式化、主机匹配等功能 |

## 3. 重要文件详细分析

### 3.1 XrdNet.hh/cc - 核心网络类

**类结构：**
- 主要成员：`iofd`(文件描述符)、`Portnum`(端口号)、`PortType`(端口类型)、`Police`(安全对象)
- 提供两个版本的 `Accept()` 方法：一个用于 TCP (返回 XrdNetAddr)，一个支持 TCP/UDP (返回 XrdNetPeer)
- `Bind()` 方法支持端口号绑定和 Unix 域套接字绑定
- `Connect()` 方法支持 TCP 和 UDP 连接
- `Relay()` 方法用于创建 UDP 中继套接字

**关键实现逻辑：**
- Accept 操作使用 poll() 实现超时控制
- TCP 接受连接后设置 TCP_NODELAY 选项
- UDP 接受需要先接收数据报以维持主机-数据报配对
- 安全检查通过 XrdNetSecurity 对象进行

### 3.2 XrdNetAddrInfo.hh - 地址信息基类

**类层次：**
```
XrdNetAddrInfo (基类，只读访问)
    └── XrdNetAddr (派生类，可修改操作)
```

**核心功能：**
- 支持 IPv4、IPv6 和 Unix 域套接字地址
- 提供地址格式化输出（fmtAuto、fmtName、fmtAddr、fmtAdv6）
- 支持地址类型判断（isLoopback、isLocal、isPrivate、isRegistered）
- DNS 解析结果缓存（通过 XrdNetCache）
- 位置信息支持（LocInfo 结构体）

### 3.3 XrdNetIF.hh - 网络接口管理

**接口类型枚举：**
```cpp
enum ifType {
    PublicV4,    // 公共 IPv4 网络
    PrivateV4,   // 私有 IPv4 网络
    PublicV6,    // 公共 IPv6 网络
    PrivateV6,   // 私有 IPv6 网络
    Public46,    // 公共双栈 (v4|6)
    Private46,   // 私有双栈 (v4|6)
    Public64,    // 公共双栈 (v6|4)
    Private64,   // 私有双栈 (v6|4)
    ifAny        // 任意可用接口
};
```

**网络路由类型：**
- `netSplit`：公共和私有地址独立路由
- `netCommon`：客户端同时具有公共和私有地址
- `netLocal`：私有地址可被域内公共客户端使用

### 3.4 XrdNetSocket.hh - Socket 封装

**主要方法：**
- `Create()`：创建命名 Unix 域套接字
- `Open()`：打开客户端/服务器套接字
- `Accept()`：接受新连接（带毫秒超时）
- `setOpts()`：设置 socket 选项（静态方法）
- `setWindow()`/`getWindow()`：设置/获取 TCP 窗口大小

### 3.5 XrdNetSecurity.hh - 安全控制

**授权机制：**
- 支持基于主机名的授权（AddHost）
- 支持基于网络组的授权（AddNetGroup）
- 使用哈希表快速查找已授权主机
- 支持安全策略合并（Merge 方法）

### 3.6 XrdNetUtils.hh - 工具函数集

**地址操作：**
- `Compare()`：比较两个 IP 地址
- `Encode()`/`Decode()`：地址编码/解码
- `IPFormat()`：IP 地址格式化为标准 V6 RFC 格式
- `GetAddrs()`：获取主机关联的多个地址
- `Hosts()`：获取主机别名列表
- `Match()`：主机名模式匹配（支持通配符）

### 3.7 XrdNetPMark.hh - 性能监控

**SciTag 规范：**
- 有效值范围：65-65535（16位正整数）
- 实验 ID 和操作 ID 分别占据高位和低位
- 支持从 CGI 参数中提取性能标记

## 4. 依赖关系

### 4.1 XrdNet 依赖的模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdSys` | 系统平台抽象（XrdSysPlatform、XrdSysPthread、XrdSysError、XrdSysFD） |
| `XrdOuc` | 通用工具类（XrdOucChain、XrdOucHash、XrdOucNList、XrdOucTList） |
| `Xrd` | 核心框架（XrdJob 用于 XrdNetRefresh） |
| 系统库 | POSIX socket、DNS 解析（getaddrinfo） |

### 4.2 依赖 XrdNet 的模块

| 被依赖模块 | 使用的组件 |
|------------|------------|
| **Xrd** | XrdNet、XrdNetAddr、XrdNetIF、XrdNetSecurity、XrdNetUtils、XrdNetRefresh、XrdNetIdentity |
| **XrdXrootd** | XrdNetPMark、XrdNetPMarkCfg、XrdNetSocket、XrdNetAddr、XrdNetIF、XrdNetMsg |
| **XrdCms** | XrdNetAddr、XrdNetIF、XrdNetSocket、XrdNetUtils、XrdNetSecurity、XrdNetMsg、XrdNetOpts |
| **XrdSec** | XrdNetAddrInfo、XrdNetAddr、XrdNetIF、XrdNetUtils |
| **XrdSecgsi** | XrdNetAddrInfo |
| **XrdSecsss** | XrdNetAddrInfo、XrdNetUtils |
| **XrdSecpwd** | XrdNetAddrInfo |
| **XrdSeckrb5** | XrdNetAddrInfo、XrdNetUtils |
| **XrdSecunix** | XrdNetAddrInfo |
| **XrdSecztn** | XrdNetAddrInfo |
| **XrdCl** | XrdNetAddr、XrdNetUtils |
| **XrdHttp** | XrdNetPMark |
| **XrdHttpTpc** | XrdNetPMark、XrdNetAddrInfo、XrdNetAddr |
| **XrdOfs** | XrdNetAddr、XrdNetIF、XrdNetUtils、XrdNetIdentity、XrdNetOpts、XrdNetSocket |
| **XrdOss** | XrdNetAddr、XrdNetUtils、XrdNetOpts、XrdNetSocket |
| **XrdBwm** | XrdNetAddr、XrdNetOpts、XrdNetSocket |
| **XrdDig** | XrdNetAddr、XrdNetUtils、XrdNetAddrInfo |
| **XrdFfs** | XrdNetAddr、XrdNetUtils |
| **XrdSsi** | XrdNetAddr、XrdNetRegistry、XrdNetAddrInfo、XrdNetIF |
| **XrdAcc** | XrdNetAddrInfo |
| **XrdOuc** | XrdNetUtils |
| **XrdPosix** | XrdNetAddr |
| **XrdApps** | XrdNetAddr、XrdNetOpts、XrdNetSocket |

## 5. 架构设计特点

1. **分层设计**：XrdNetAddrInfo（只读）→ XrdNetAddr（可写）的继承层次，实现信息封装
2. **双栈支持**：原生支持 IPv4/IPv6，包括 mapped IPv4 地址处理
3. **平台兼容**：通过条件编译支持 Windows（Winsock2）和 POSIX 系统
4. **线程安全**：XrdNetCache、XrdNetSecurity 等使用互斥锁保护
5. **性能优化**：DNS 缓存、连接池（XrdNetBufferQ）、非阻塞 I/O
6. **安全控制**：内置主机授权机制，支持主机名模式匹配和网络组

## 6. 总结

XrdNet 模块是 XRootD 分布式文件系统的网络基础层，为上层模块提供统一、安全、高效的网络通信接口。该模块被 XRootD 生态系统中的几乎所有核心模块广泛使用，是整个项目最关键的基础设施之一。
