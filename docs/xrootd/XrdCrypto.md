# XrdCrypto 模块分析

## 一、模块概述

`XrdCrypto` 是 XRootD 项目中的**核心密码学模块**，提供对称加密、非对称加密（RSA）、消息摘要、X.509 证书链管理、GSI（Grid Security Infrastructure）安全策略等功能。它采用**插件式工厂模式**，将抽象接口与具体实现（基于 OpenSSL）分离，允许通过插件切换不同的密码学后端（如 OpenSSL、Botan 等）。

该模块是 XRootD 安全认证体系（GSI）的底层基础，为 `XrdSecgsi`、`XrdSecpwd`、`XrdHttp`、`XrdSecsss` 等上层模块提供密码学原语。

---

## 二、构建产物

从 `CMakeLists.txt` 可知，该模块构建产生三个独立的共享库/插件：

| 构建目标 | 类型 | 说明 |
|---|---|---|
| **XrdCryptoLite** | SHARED 库 | 轻量级加密库，仅依赖 `XrdUtils` 和 `OpenSSL::Crypto`，提供简单流式加密接口 |
| **XrdCrypto** | SHARED 库 | 主加密抽象库，包含所有抽象接口和 GSI 策略链，依赖 `XrdUtils` 和 `dl` |
| **XrdCryptossl** | MODULE 插件 | OpenSSL 具体实现插件，依赖 `XrdCrypto`、`XrdUtils`、`OpenSSL::SSL` 和线程库 |

另外，部分源文件（`XrdCryptoAux`, `XrdCryptoRSA`, `XrdCryptoX509*`, `XrdCryptosslAux`, `XrdCryptosslRSA`, `XrdCryptosslX509*`, `XrdCryptosslgsiAux`）被直接编译进 `XrdUtils` 库，以避免 `XrdUtils` 对整个 `libXrdCryptossl` 的链接依赖。

---

## 三、文件清单与功能说明

### 3.1 基础类（抽象接口层）

| 文件 | 功能 |
|---|---|
| `XrdCryptoBasic.hh/cc` | **密码学基本缓冲区类**。所有密码学对象的基类，提供内存缓冲区管理、十六进制转换、与 `XrdSutBucket` 的序列化/反序列化 |
| `XrdCryptoCipher.hh/cc` | **对称加密密码器抽象接口**。定义密钥协商（DH）、加密/解密、IV 管理等虚函数 |
| `XrdCryptoMsgDigest.hh/cc` | **消息摘要抽象接口**。定义 `Reset`/`Update`/`Final` 三步式消息摘要计算接口 |
| `XrdCryptoRSA.hh/cc` | **RSA 非对称加密抽象接口**。定义密钥导入导出、公私钥加解密接口 |
| `XrdCryptoX509.hh/cc` | **X.509 证书抽象接口**。定义证书有效性检查、属性提取（Issuer/Subject/Serial/有效期）、签名验证、SAN 匹配等 |
| `XrdCryptoX509Chain.hh/cc` | **X.509 证书链管理**。单向链表管理证书栈，支持链排序、验证（含 CRL 吊销检查）、CA 状态追踪 |
| `XrdCryptoX509Crl.hh/cc` | **X.509 证书吊销列表（CRL）抽象接口**。定义 CRL 有效性检查、证书吊销查询等 |
| `XrdCryptoX509Req.hh/cc` | **X.509 证书签名请求（CSR）抽象接口**。定义请求的验证、导出、Subject 提取等 |
| `XrdCryptoFactory.hh/cc` | **密码学工厂抽象接口**。核心工厂模式定义，提供 Cipher/MsgDigest/RSA/X509/X509Crl/X509Req 的创建方法，以及 X509 验证/解析/代理证书操作的函数指针钩子。`GetCryptoFactory()` 静态方法通过 `dlopen` 动态加载插件 |
| `XrdCryptoAux.hh/cc` | **密码学辅助工具**。定义追踪标志、RSA 参数常量、密钥派生函数（PBKDF2）接口、时区修正工具 |
| `XrdCryptoTrace.hh` | **追踪/调试宏定义**。定义 `TRACE`/`DEBUG`/`PRINT` 等调试输出宏 |

### 3.2 OpenSSL 实现层（XrdCryptossl 插件）

| 文件 | 功能 |
|---|---|
| `XrdCryptosslFactory.hh/cc` | **OpenSSL 工厂实现**。继承 `XrdCryptoFactory`，实现所有虚方法，创建 OpenSSL 后端的具体对象。是插件的入口点（`XrdCryptosslFactoryObject` 导出函数） |
| `XrdCryptosslCipher.hh/cc` | **OpenSSL 对称加密实现**。基于 `EVP_CIPHER` 实现 Blowfish(AES) 等对称加密，支持 DH 密钥协商（含固定 3072 位 DH 参数）、IV 管理、序列化为 Bucket |
| `XrdCryptosslMsgDigest.hh/cc` | **OpenSSL 消息摘要实现**。基于 `EVP_MD` 实现 MD5/SHA1/SHA256 等摘要算法 |
| `XrdCryptosslRSA.hh/cc` | **OpenSSL RSA 实现**。基于 OpenSSL RSA API 实现密钥生成、导入导出、公私钥加解密 |
| `XrdCryptosslX509.hh/cc` | **OpenSSL X.509 证书实现**。基于 OpenSSL `X509` 结构实现证书解析、属性提取、签名验证、SAN 匹配等 |
| `XrdCryptosslX509Crl.hh/cc` | **OpenSSL CRL 实现**。基于 OpenSSL 实现 CRL 解析、吊销检查 |
| `XrdCryptosslX509Req.hh/cc` | **OpenSSL 证书请求实现**。基于 OpenSSL 实现 CSR 解析和验证 |
| `XrdCryptosslAux.hh/cc` | **OpenSSL 辅助函数集**。实现 PBKDF2 密钥派生、X509 证书链验证/导出/解析、代理证书（Proxy Certificate）创建/签名/验证、VOMS 属性提取等 |
| `XrdCryptosslgsiAux.cc` | **GSI 高级辅助函数**。实现 GSI 策略相关的复杂功能：代理证书创建（RFC 3820）、代理请求签名、VOMS 属性解析、X509 扩展处理等（1529 行，最复杂的实现文件） |
| `XrdCryptosslTrace.hh` | **OpenSSL 插件追踪宏**。定义 `sslTrace` 相关的追踪宏 |

### 3.3 GSI 扩展

| 文件 | 功能 |
|---|---|
| `XrdCryptogsiX509Chain.hh/cc` | **GSI 策略证书链**。继承 `XrdCryptoX509Chain`，强制执行 GSI 策略（如 RFC 3820 代理证书命名规则、链验证策略） |

### 3.4 CryptoLite（轻量级加密）

| 文件 | 功能 |
|---|---|
| `XrdCryptoLite.hh/cc` | **轻量级加密抽象接口**。提供极简的流式加密接口（Create/Encrypt/Decrypt），仅支持 "bf32" 算法（Blowfish + CRC32 校验） |
| `XrdCryptoLite_BFecb.hh/cc` | **Blowfish ECB 模式实现**。单 64 位块加密，用于短消息防伪（非隐私保护），线程安全（内部加锁） |
| `XrdCryptoLite_bf32.cc` | **bf32 算法实现**。组合 Blowfish ECB 加密 + CRC32 校验，实现 CryptoLite 接口 |

### 3.5 测试

| 文件 | 功能 |
|---|---|
| `XrdCryptotest.cc` | **XrdCrypto 单元测试程序**。测试 Cipher、MsgDigest、RSA、X509 等功能 |

---

## 四、架构设计分析

### 4.1 插件式工厂模式

```
XrdCryptoFactory（抽象工厂）
    ├── XrdCryptosslFactory（OpenSSL 实现，作为动态插件加载）
    └── 可扩展其他实现（Botan 等）

工厂创建方法：
    ├── Cipher()         → XrdCryptoCipher（抽象）← XrdCryptosslCipher（实现）
    ├── MsgDigest()      → XrdCryptoMsgDigest（抽象）← XrdCryptosslMsgDigest（实现）
    ├── RSA()            → XrdCryptoRSA（抽象）← XrdCryptosslRSA（实现）
    ├── X509()           → XrdCryptoX509（抽象）← XrdCryptosslX509（实现）
    ├── X509Crl()        → XrdCryptoX509Crl（抽象）← XrdCryptosslX509Crl（实现）
    └── X509Req()        → XrdCryptoX509Req（抽象）← XrdCryptosslX509Req（实现）
```

`GetCryptoFactory("ssl")` 会通过 `dlopen` 加载 `libXrdCryptossl.so`，调用导出函数 `XrdCryptosslFactoryObject()` 获取工厂单例。

### 4.2 类继承体系

```
XrdCryptoBasic（基础缓冲区）
    ├── XrdCryptoCipher（对称加密）
    │     └── XrdCryptosslCipher
    └── XrdCryptoMsgDigest（消息摘要）
          └── XrdCryptosslMsgDigest

XrdCryptoRSA（RSA 非对称加密，独立接口）
    └── XrdCryptosslRSA

XrdCryptoX509（X.509 证书，独立接口）
    └── XrdCryptosslX509

XrdCryptoX509Chain（证书链）
    └── XrdCryptogsiX509Chain（GSI 策略扩展）

XrdCryptoX509Crl / XrdCryptoX509Req（CRL / CSR）
    └── 对应 SSL 实现

XrdCryptoLite（轻量加密独立接口）
    └── XrdCryptoLite_bf32（Blowfish + CRC32）
```

### 4.3 DH 密钥协商

`XrdCryptosslCipher` 实现了基于 Diffie-Hellman 的密钥协商协议：
- 使用**固定的 3072 位 DH 参数**（硬编码 PEM 格式），解决了 OpenSSL 3.0 与 1.0.2 之间的兼容性问题
- 支持 OpenSSL 1.x 和 OpenSSL 3.0 双版本 API
- 密钥派生后使用 Blowfish-CBC 进行对称加密

---

## 五、模块依赖关系

### 5.1 XrdCrypto 依赖的其他模块

| 依赖模块 | 用途 |
|---|---|
| **XrdUtils** | 基础工具库（日志、字符串、哈希、随机数等） |
| **OpenSSL::Crypto** | OpenSSL 密码学库底层原语 |
| **OpenSSL::SSL** | OpenSSL SSL/TLS 库（仅 XrdCryptossl 插件） |
| **XrdSut** (`XrdSutBucket`, `XrdSutRndm`) | 数据容器（Bucket）和随机数生成 |
| **XrdOuc** (`XrdOucString`, `XrdOucHash`, `XrdOucPinLoader`, `XrdOucTrace`) | 字符串、哈希表、插件加载器、追踪 |
| **XrdSys** (`XrdSysError`, `XrdSysPthread`, `XrdSysLogger`) | 系统工具（错误日志、线程） |
| **XrdProtocol** (`XProtocol`, `XPtypes`) | 协议类型定义（`kXR_int32` 等） |
| **XrdTls** (`XrdTlsContext`) | TLS 上下文初始化（仅工厂初始化时调用） |
| **XrdVersion** | 版本信息（插件版本校验） |
| **dl** (系统库) | 动态库加载（`dlopen`/`dlsym`） |

### 5.2 依赖 XrdCrypto 的其他模块

| 上层模块 | 依赖的构建目标 | 用途 |
|---|---|---|
| **XrdUtils** | 源码级编译（非链接） | X509/RSA/SSL 辅助函数直接编入 XrdUtils |
| **XrdSecgsi** | `XrdCrypto` | GSI 安全认证模块，使用证书链验证、代理证书等 |
| **XrdSecpwd** | `XrdCrypto` | 密码安全认证模块 |
| **XrdHttp** | `XrdCrypto` | HTTP 协议模块，用于 TLS/证书处理 |
| **XrdSecsss** | `XrdCryptoLite` | SSS（简单共享密钥）安全模块，使用轻量级加密 |
| **XrdSecunix** | 间接依赖 | 通过 XrdUtils 间接使用 |

---

## 六、关键设计要点

1. **插件化架构**：密码学实现通过 `XrdOucPinLoader` 动态加载，实现了接口与实现的完全解耦。
2. **双版本 OpenSSL 兼容**：通过 `#if OPENSSL_VERSION_NUMBER >= 0x30000000L` 条件编译，同时支持 OpenSSL 1.0.2（RHEL7）和 OpenSSL 3.0+（RHEL9）。
3. **固定 DH 参数策略**：放弃每次启动生成 DH 参数的做法，改用硬编码的 3072 位固定参数，平衡安全性与启动性能。
4. **GSI 策略分离**：基础 `XrdCryptoX509Chain` 只提供通用链管理，GSI 特定策略（RFC 3820 代理证书规则）通过 `XrdCryptogsiX509Chain` 子类实现。
5. **CryptoLite 独立性**：`XrdCryptoLite` 是完全独立的轻量级加密库，不依赖 `XrdCrypto` 的类层次，适用于简单场景（如 SSS 认证）。
