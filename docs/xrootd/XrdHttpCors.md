# XrdHttpCors 模块分析

## 模块概述

XrdHttpCors 是 XRootD 框架中的一个 HTTP CORS（跨源资源共享）插件模块。它为 XRootD HTTP 服务器提供 CORS 支持，允许浏览器端的 Web 应用程序从不同源的服务器请求资源。当前该插件仅支持 `Access-Control-Allow-Origin` 响应头。

## 文件结构

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | 构建配置，定义模块编译为动态库，链接 XrdUtils |
| `XrdHttpCors.hh` | CORS 插件的抽象基类定义，声明插件接口和工厂函数 |
| `XrdHttpCorsHandler.hh` | CORS 处理器的具体实现类声明 |
| `XrdHttpCorsHandler.cc` | CORS 处理器的核心逻辑实现 |
| `README.md` | 使用说明文档，描述配置方法和工作原理 |

## 详细分析

### 1. CMakeLists.txt

```cmake
set(XrdHttpCors XrdHttpCors-${PLUGIN_VERSION})
add_library(${XrdHttpCors} MODULE XrdHttpCorsHandler.cc)
target_link_libraries(${XrdHttpCors} XrdUtils)
install(TARGETS ${XrdHttpCors} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
```

- 编译为动态库（MODULE 类型）
- 唯一的依赖是 `XrdUtils`
- 安装到标准库目录

### 2. XrdHttpCors.hh（接口定义）

定义了 CORS 插件的抽象基类 `XrdHttpCors`，包含以下纯虚函数：

| 方法 | 说明 |
|------|------|
| `Configure(const char* configFN, XrdSysError* errP)` | 从配置文件加载 CORS 配置 |
| `addAllowedOrigin(const std::string& origin)` | 添加可信源（Origin） |
| `getCORSAllowOriginHeader(const std::string& origin)` | 根据请求源返回对应的 CORS 头 |

关键设计：
- 使用 `std::optional<std::string>` 作为返回值，当请求的 Origin 不在可信列表中时返回 `std::nullopt`
- 提供工厂函数 `XrdHttpCorsGetHandler` 用于动态加载插件实例

### 3. XrdHttpCorsHandler.hh（实现类声明）

`XrdHttpCorsHandler` 继承自 `XrdHttpCors`，核心数据结构：

```cpp
std::unordered_set<std::string> m_origins;  // 存储所有可信源
```

### 4. XrdHttpCorsHandler.cc（核心实现）

#### 工厂函数
```cpp
extern "C" XrdHttpCors *XrdHttpCorsGetHandler(XrdHttpCorsGetHandlerArgs) {
  return new XrdHttpCorsHandler();
}
```

#### Configure 方法
- 使用 `XrdOucGatherConf` 读取配置文件中的 `cors.origin` 参数
- 支持空格分隔或多行重复配置
- 调用 `addAllowedOrigin` 添加每个可信源

#### getCORSAllowOriginHeader 方法
- 在 `m_origins` 哈希集合中查找请求的 Origin
- 匹配成功返回 `"Access-Control-Allow-Origin: <origin>"` 头
- 不匹配返回 `std::nullopt`

#### addAllowedOrigin 方法
- 使用 `XrdOucUtils::trim` 去除空格
- 过滤空字符串后添加到哈希集合

#### 版本信息
```cpp
XrdVERSIONINFO(XrdHttpCorsget, XrdHttpCorsHandler);
```

## 模块依赖

### XrdHttpCors 依赖的模块
- **XrdUtils** - 基础工具库（CMakeLists.txt 中链接）
- **XrdOucGatherConf** - 配置文件解析工具（XrdOuc 库）
- **XrdOucUtils** - 通用工具函数（字符串处理等）
- **XrdSysError** - 错误处理和日志记录
- **XrdVersion** - 版本信息支持

### 依赖 XrdHttpCors 的模块
- **XrdHttp**（XrdHttpProtocol）- HTTP 协议处理模块

## 集成机制

XrdHttpCors 通过动态加载方式集成到 XrdHttp 模块：

1. **加载阶段**（XrdHttpProtocol.cc:3240-3248）：
   - `XrdHttpProtocol::LoadCorsHandler` 使用 `XrdOucPinLoader` 动态加载 CORS 库
   - 调用 `XrdHttpCorsGetHandler` 工厂函数获取插件实例
   - 存储在静态成员 `XrdHttpProtocol::xrdcors`

2. **配置阶段**（XrdHttpProtocol.cc:1063-1067）：
   - 从配置文件读取 `http.cors` 参数指定的库路径
   - 调用 `xrdcors->Configure()` 加载 CORS 配置

3. **运行阶段**（XrdHttpProtocol.cc:1562-1567）：
   - 在构建 HTTP 响应头时调用 `xrdcors->getCORSAllowOriginHeader()`
   - 如果 Origin 匹配可信源，将 CORS 头添加到响应中

## 配置方式

在 XRootD 服务器配置文件中：

```
# 启用 CORS 插件
http.cors libXrdHttpCors.so

# 添加可信源（支持多行或空格分隔）
cors.origin https://myhttpserver1.cern.ch
cors.origin https://myhttpserver2.cern.ch
```

## 设计特点

1. **插件架构**：通过动态库和工厂函数实现，可独立加载/卸载
2. **接口抽象**：基类和实现分离，便于扩展其他 CORS 策略
3. **高效查找**：使用 `unordered_set` 实现 O(1) 复杂度的 Origin 匹配
4. **容错处理**：对空字符串和空白字符进行过滤处理
5. **版本兼容**：使用 `XrdVERSIONINFO` 宏确保版本兼容性
