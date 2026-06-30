# XrdOssMirage 模块分析

## 概述

XrdOssMirage 是 XRootD 的一个**服务端侧插件**，用于**模拟文件系统的存在**，无需任何真实存储。上传的文件内容会被丢弃，仅保留文件元数据（如文件大小）。读取文件时，插件支持三种模式：返回任意内存数据、返回重复字符模式、返回重复字符串模式。所有文件系统状态仅存在于**易失性内存**中，服务器重启后全部消失。

该模块主要用于**测试和开发场景**，例如模拟大文件传输而无需实际传输大量数据，或模拟特定的错误条件（如读写失败）。

## 文件列表

| 文件名 | 一句话描述 |
|--------|-----------|
| `CMakeLists.txt` | 构建配置：编译为 MODULE 动态库，链接 XrdUtils 和 XrdServer |
| `README.md` | 使用说明文档：配置方法、扩展属性用法、示例 |
| `XrdOssMirage.hh` | 主类头文件：继承 `XrdOss`，定义虚拟文件系统的管理接口 |
| `XrdOssMirage.cc` | 主类实现：文件创建/删除/重命名/截断/状态查询等操作的内存实现 |
| `XrdOssMirageFile.hh` | 文件操作类头文件：继承 `XrdOssDF`，定义文件级读写接口 |
| `XrdOssMirageFile.cc` | 文件操作类实现：Open/Read/Write/Close/Ftruncate，支持模式生成 |
| `XrdOssMirageDir.hh` | 目录操作类头文件：继承 `XrdOssDF`，定义目录遍历接口 |
| `XrdOssMirageDir.cc` | 目录操作类实现：所有操作均返回 `-ENOTSUP`（不支持目录） |
| `XrdOssMirageEntry.hh` | 文件条目数据结构：存储文件元数据（大小、模式、自定义返回码） |
| `XrdOssMirageXAttr.hh` | 扩展属性类头文件：继承 `XrdSysXAttr`，管理文件的自定义属性 |
| `XrdOssMirageXAttr.cc` | 扩展属性类实现：Get/Set/Del 操作，用于配置模拟行为 |

## 依赖关系

### 该模块依赖的其他模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdOss` (XrdOss.hh) | 提供基类 `XrdOss`（存储系统接口）和 `XrdOssDF`（数据文件接口） |
| `XrdSysXAttr` (XrdSysXAttr.hh) | 提供扩展属性基类 `XrdSysXAttr`，用于实现文件属性管理 |
| `XrdSysFAttr` (XrdSysFAttr.hh) | 提供文件属性系统接口，用于获取全局 XAttr 实例 |
| `XrdUtils` | XRootD 工具库 |
| `XrdServer` | XRootD 服务器核心库 |
| `XrdVersion` (XrdVersion.hh) | 提供 `XrdVERSIONINFO` 宏用于插件版本标识 |

### 依赖该模块的其他模块

该模块是独立的**运行时插件**，通过 XRootD 的 `ofs.osslib` 和 `ofs.xattrlib` 配置项在运行时加载，**没有其他编译时模块**依赖它。

## 详细文件结构分析

### XrdOssMirageEntry.hh — 文件条目数据结构

这是整个模块的核心数据结构，定义了每个"幻影文件"的元信息：

```cpp
struct XrdOssMirageEntry {
    struct { int return_code{XrdOssOK}; } open;           // 打开文件时的自定义返回码
    struct {
        int return_code{XrdOssOK};                         // 读取时的自定义返回码
        std::size_t return_position{};                     // 在哪个偏移量触发错误
    } read;
    struct {
        int return_code{XrdOssOK};                         // 写入时的自定义返回码
        std::size_t return_position{};                     // 在哪个偏移量触发错误
    } write;
    std::string pattern{};                                 // 内容生成模式
    std::size_t size{};                                    // 文件大小（虚拟的）
};
using XrdOssMirageEntryPtr = std::shared_ptr<XrdOssMirageEntry>;
```

### XrdOssMirage.hh / XrdOssMirage.cc — 主存储系统类

继承自 `XrdOss`，是 XRootD 存储系统的插件入口。

**核心成员：**
- `std::unordered_map<std::string, XrdOssMirageEntryPtr> entries` — 以路径为键的内存文件表
- `std::mutex mutex` — 线程安全保护

**关键方法：**
- `XrdOssGetStorageSystem()` — C 链接的工厂函数，XRootD 通过此函数加载插件
- `Create()` — 创建文件条目，设置初始大小为 0，首次创建时注入 XAttr 引用
- `Rename()` — 在内存映射中移动条目
- `Stat()` — 返回文件的虚拟大小
- `Truncate()` — 修改文件的虚拟大小
- `Unlink()` — 从内存映射中删除条目
- `Mkdir()` / `Remdir()` / `Chmod()` — 均返回 `-ENOTSUP`（不支持）
- `get_entry_read()` / `get_entry_write()` — 供 File 和 XAttr 类获取条目（带锁保护）

**设计亮点：**
- 读取操作获取的是条目的**拷贝**（值语义），写入操作获取的是**共享指针**（引用语义）
- 通过 `use_count()` > 1 判断条目是否正在被写入，避免读写冲突

### XrdOssMirageFile.hh / XrdOssMirageFile.cc — 文件操作类

继承自 `XrdOssDF`，处理单个文件的打开、读写和关闭。

**Open 逻辑：**
- 只读模式 (`O_RDONLY`)：调用 `get_entry_read()` 获取条目拷贝，存入 `variant<XrdOssMirageEntry, XrdOssMirageEntryPtr>` 的第一个成员
- 读写模式：调用 `get_entry_write()` 获取共享指针，存入 variant 的第二个成员
- 检查 `open.return_code`，若非 OK 则返回自定义错误码

**Read 逻辑：**
- 检查 `read.return_code` 和 `read.return_position`，在指定偏移量范围内返回错误
- 根据 `entry->pattern` 的长度生成内容：
  - 空模式：不写入任何数据（返回任意内存内容）
  - 单字符模式：使用 `std::fill_n` 填充
  - 多字符模式：使用 `std::generate_n` 循环生成重复模式

**Write 逻辑：**
- 检查 `write.return_code` 和 `write.return_position`
- 不存储数据，仅累加文件大小：`entry->size += size`

**Close 逻辑：**
- 如果 entry_storage 持有共享指针，则释放引用

### XrdOssMirageDir.hh / XrdOssMirageDir.cc — 目录操作类

所有方法（`Opendir`、`Readdir`、`StatRet`、`Close`）均返回 `-ENOTSUP`，表明该插件**不支持目录操作**。

### XrdOssMirageXAttr.hh / XrdOssMirageXAttr.cc — 扩展属性类

继承自 `XrdSysXAttr`，通过 XRootD 的扩展属性系统暴露配置接口。

**支持的属性名（带 `U.` 前缀）：**

| 属性名 | 说明 |
|--------|------|
| `U.open.return_code` | 打开文件时返回的自定义错误码 |
| `U.read.return_code` | 读取文件时返回的自定义错误码 |
| `U.read.return_position` | 读取错误触发的偏移量位置 |
| `U.write.return_code` | 写入文件时返回的自定义错误码 |
| `U.write.return_position` | 写入错误触发的偏移量位置 |
| `U.pattern` | 文件内容生成模式（字符串） |

**Get/Set/Del 实现：**
- `Get`：通过 `get_entry_read()` 获取条目拷贝，将属性值转换为字符串返回
- `Set`：通过 `get_entry_write()` 获取可写引用，解析字符串值并设置到对应字段
- `Del`：将对应属性重置为默认值
- `List`：返回 `-ENOTSUP`（不支持列举）

**初始化：**
- 通过 `XrdOssMirage::Create()` 中的 `std::call_once` 机制，首次创建文件时自动注入 XAttr 引用

## 配置与使用

### 基本启用

在 XRootD 配置文件中添加：
```
ofs.osslib libXrdOssMirage.so
```

### 启用扩展属性

若需使用自定义错误码和内容模式：
```
ofs.xattrlib libXrdOssMirage.so
```

### 典型用例

1. **模拟大文件**：上传空文件后 truncate 到目标大小
2. **模拟读取错误**：设置 `read.return_code` 和 `read.return_position`
3. **模拟写入错误**：设置 `write.return_code` 和 `write.return_position`
4. **生成确定性内容**：设置 `pattern` 属性

## 架构总结

```
XrdOss (基类)
  └── XrdOssMirage (主存储系统)
        ├── entries (内存文件表)
        ├── XrdOssMirageFile (文件操作)
        │     └── XrdOssMirageEntry (条目数据)
        ├── XrdOssMirageDir (目录操作，全部不支持)
        └── XrdOssMirageXAttr (扩展属性，配置模拟行为)
              └── XrdOssMirageEntry (读写条目属性)
```
