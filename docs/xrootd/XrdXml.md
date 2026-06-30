# XrdXml 模块分析

## 模块概述

`XrdXml` 是 XRootD 项目中的 **XML 解析模块**，提供对 XML 文件的统一读取接口。该模块的核心功能是将 Metalink XML 规范（RFC 5854）解析为 `XrdOucFileInfo` 文件信息对象，用于 XRootD 的文件发现和重定向机制。

该模块采用 **策略模式（Strategy Pattern）** 设计，通过抽象基类 `XrdXmlReader` 定义统一接口，底层支持两种 XML 解析引擎：
- **tinyxml**（内置默认）：轻量级 DOM 解析器，适合小型 XML 文档
- **libxml2**（可选）：功能完整的流式解析器，适合大型文档，需编译时启用 `HAVE_XML2`

## 文件列表与功能说明

### 核心源码文件

| 文件名 | 功能描述 |
|--------|----------|
| `XrdXmlReader.hh` | 定义 XML 读取器的抽象基类接口，声明 `GetReader()`、`GetElement()`、`GetAttributes()`、`GetText()` 等纯虚方法 |
| `XrdXmlReader.cc` | 实现工厂方法 `GetReader()` 和 `Init()`，根据 `impl` 参数创建 tinyxml 或 libxml2 实例 |
| `XrdXmlRdrTiny.hh` | tinyxml 引擎的子类声明，继承自 `XrdXmlReader`，内部持有 `TiXmlDocument` 和 `TiXmlNode` 等成员 |
| `XrdXmlRdrTiny.cc` | tinyxml 引擎的完整实现，基于 DOM 树遍历方式解析 XML 元素、属性和文本 |
| `XrdXmlRdrXml2.hh` | libxml2 引擎的子类声明，继承自 `XrdXmlReader`，内部持有 `_xmlTextReader*` 流式读取器 |
| `XrdXmlRdrXml2.cc` | libxml2 引擎的完整实现，基于 `xmlTextReader` API 的流式解析，支持大文档 |
| `XrdXmlMetaLink.hh` | Metalink 解析器声明，定义 `Convert()` 和 `ConvertAll()` 方法，将 Metalink XML 转换为 `XrdOucFileInfo` 对象 |
| `XrdXmlMetaLink.cc` | Metalink 解析器的完整实现，解析 Metalink v3/v4 格式的文件 URL、哈希、大小、优先级等信息 |
| `CMakeLists.txt` | 构建配置，定义 `XrdXml` 共享库的编译目标、依赖链接和可选的 libxml2 支持 |

### tinyxml 子目录（内置第三方库）

| 文件名 | 功能描述 |
|--------|----------|
| `tinyxml.h` / `tinyxml.cpp` | TinyXML 核心库，提供 DOM 方式的 XML 解析 |
| `tinystr.h` / `tinystr.cpp` | TinyXML 字符串工具类 |
| `tinyxmlparser.cpp` | TinyXML 解析器实现 |
| `tinyxmlerror.cpp` | TinyXML 错误处理实现 |
| `CMakeLists.txt` | 构建配置，编译为 `XrdTinyXml` 静态对象库 |

## 详细结构分析

### 1. XrdXmlReader — 抽象接口层

```
XrdXmlReader (抽象基类)
├── GetReader(fname, enc, impl)  — 静态工厂方法，创建具体的解析器实例
├── Init(impl)                   — 静态初始化方法，用于多线程环境预初始化
├── GetElement(ename, reqd)      — 纯虚方法，查找 XML 标签元素
├── GetAttributes(aname, aval)   — 纯虚方法，获取标签属性值
├── GetText(ename, reqd)         — 纯虚方法，获取标签文本内容
└── GetError(ecode)              — 纯虚方法，获取最近的错误描述
```

设计要点：
- `ename[0]` 作为上下文标签名，用于限定搜索范围；后续元素为要查找的目标标签名
- 支持通过 `reqd` 参数控制是否必须找到指定元素
- 内存管理：返回的字符串调用方需用 `free()` 释放

### 2. XrdXmlRdrTiny — tinyxml 实现

基于 DOM（文档对象模型）方式解析：
- 构造时使用 `TiXmlDocument::LoadFile()` 将整个 XML 加载到内存
- `GetElement()` 通过 `FirstChild()` / `NextSibling()` 遍历 DOM 树
- 维护 `curNode`、`curElem`、`elmNode` 三个指针跟踪当前解析位置
- 仅支持小型 XML 文档（内存受限）

### 3. XrdXmlRdrXml2 — libxml2 实现

基于流式（SAX-like）方式解析：
- 构造时使用 `xmlNewTextReaderFilename()` 创建流式读取器
- `GetElement()` 通过 `xmlTextReaderRead()` 逐节点读取
- 内存效率更高，适合大型 XML 文档
- 需要多线程预初始化（`xmlInitParser()`）

### 4. XrdXmlMetaLink — Metalink 解析器

支持 Metalink 规范的两个版本：
- **v3**（namespace: `http://www.metalinker.org/`）：需要定位到 `<files>` 标签
- **v4**（namespace: `urn:ietf:params:xml:ns:metalink`）：直接在 `<metalink>` 下解析

解析流程：
1. 通过 `XrdXmlReader::GetReader()` 获取 XML 解析器
2. 定位 `<metalink>` 根标签，读取 `xmlns` 属性判断版本
3. 遍历 `<file>` 标签，提取 `<url>`、`<hash>`、`<size>`、`<glfn>` 等信息
4. 将解析结果封装为 `XrdOucFileInfo` 对象链表返回
5. 支持协议过滤（通过 `prots` 参数指定允许的协议列表）
6. 支持全局文件条目构造（通过 `rdProt`/`rdHost` 参数）

### 5. 构建配置

```cmake
# XrdXml 共享库
target_link_libraries(XrdXml
  PUBLIC  XrdTinyXml          # tinyxml 对外暴露
  PRIVATE XrdUtils            # 工具函数（仅内部使用）
          ${CMAKE_THREAD_LIBS_INIT}
)

# 可选的 libxml2 支持
find_package(LibXml2)
if(LIBXML2_FOUND)
  target_sources(XrdXml PRIVATE XrdXmlRdrXml2.cc XrdXmlRdrXml2.hh)
  target_compile_definitions(XrdXml PRIVATE HAVE_XML2)
  target_link_libraries(XrdXml PRIVATE LibXml2::LibXml2)
endif()
```

## 依赖关系

### XrdXml 依赖的模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdTinyXml` | 内置 tinyxml 解析库（PUBLIC 依赖） |
| `XrdUtils` | 工具函数库（PRIVATE 依赖） |
| `XrdSys` | 系统工具（`XrdSysE2T` 错误转文本、`XrdSysFD` 文件操作、`XrdSysPthread` 互斥锁、`XrdSysAtomics` 原子操作） |
| `XrdOuc` | `XrdOucFileInfo` 文件信息类（用于 Metalink 解析输出） |
| `LibXml2` | 可选的 libxml2 库（仅在启用 `HAVE_XML2` 时） |
| 线程库 | `CMAKE_THREAD_LIBS_INIT`（pthreads 等） |

### 依赖 XrdXml 的模块

| 模块 | 用途 |
|------|------|
| `XrdCl` | XRootD 客户端库，通过 `XrdClMetalinkRedirector` 使用 `XrdXmlMetaLink` 解析 Metalink 响应实现文件重定向 |
| `XrdClHttp` | HTTP 客户端模块 |
| `XrdClS3` | S3 存储客户端模块 |

## 设计总结

- **工厂模式**：通过 `XrdXmlReader::GetReader()` 静态方法创建解析器实例，调用方无需关心底层实现
- **策略模式**：tinyxml 和 libxml2 作为可互换的解析策略，通过编译选项切换
- **职责分离**：`XrdXmlReader` 负责 XML 解析抽象，`XrdXmlMetaLink` 负责 Metalink 协议的语义解析
- **防御性编程**：内置 `CleanUp` RAII 类确保异常路径下的资源释放；使用 `vecMon` 辅助类自动释放属性值数组
