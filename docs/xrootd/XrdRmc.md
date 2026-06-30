# XrdRmc 模块分析

## 1. 模块概述

XrdRmc（XRootD Real Memory Cache）是 XRootD 框架中的**通用内存缓存模块**，实现了 `XrdOucCache` 抽象接口，提供对任意数据源（如文件、套接字等）的内存缓存功能。该模块采用基于分页的 LRU（最近最少使用）缓存淘汰策略，支持预读（Preread）机制、结构化文件优化、读写缓存、多线程安全等特性。

**核心功能：**
- 基于 mmap 的高效内存缓存管理
- 分页式缓存（默认页大小 32KB，最小 4KB，最大 16MB）
- 自动预读和手动预读支持
- LRU 缓存淘汰策略
- 支持读写穿透（Write-Through）缓存
- 多线程安全的并发控制
- 缓存统计信息收集

## 2. 文件列表

| 文件名 | 作用 |
|--------|------|
| `CMakeLists.txt` | 构建配置文件，将源文件添加到 XrdUtils 库目标 |
| `XrdRmc.hh` | 缓存创建工厂类头文件，定义缓存参数结构体和选项常量 |
| `XrdRmc.cc` | 缓存创建工厂类实现，通过 Create() 方法创建 XrdRmcReal 实例 |
| `XrdRmcData.hh` | 缓存数据访问类头文件，封装对缓存的读写操作和预读队列管理 |
| `XrdRmcData.cc` | 缓存数据访问类实现，包含 Read/Write/Preread/Detach 等核心操作 |
| `XrdRmcReal.hh` | 缓存核心实现类头文件，定义缓存的内存管理和页表结构 |
| `XrdRmcReal.cc` | 缓存核心实现类实现，包含 Attach/Detach/Get/Ref/Trunc 等底层操作 |
| `XrdRmcSlot.hh` | 缓存槽位数据结构头文件，定义 LRU 链表、哈希链表等底层数据结构 |

## 3. 架构设计

### 3.1 类层次结构

```
XrdOucCache (抽象基类，定义在 XrdOuc/XrdOucCache.hh)
    └── XrdRmcReal (实际缓存实现)
            ├── 管理内存映射缓存区域 (Base)
            ├── 管理槽位数组 (Slots[])
            ├── 管理哈希表 (Slash[])
            └── 管理预读线程池

XrdOucCacheIO (抽象基类，定义在 XrdOuc/XrdOucCache.hh)
    └── XrdRmcData (缓存 IO 代理)
            ├── 封装 XrdOucCacheIO 对象
            ├── 管理每连接的预读队列
            └── 处理并发控制 (MRSW)

XrdRmcSlot (底层数据结构)
    ├── LRU 链表操作 (Push/Pull/reRef/unRef)
    ├── 哈希链表操作 (Find/Hide)
    ├── 所有权链表操作 (Owner)
    └── IO 等待队列 (ioQ)
```

### 3.2 核心数据结构

#### 缓存参数 (XrdRmc::Parms)
```cpp
struct Parms {
    long long CacheSize;  // 缓存总大小（默认 100MB）
    int       PageSize;   // 页大小（默认 32KB，必须是 2 的幂）
    int       Max2Cache;  // 最大缓存读取量（默认 PageSize）
    int       MaxFiles;   // 最大文件数（默认 256 或 8192）
    int       Options;    // 选项位掩码
    short     minPages;   // 最小页数（默认 256）
};
```

#### 缓存选项常量
| 常量 | 值 | 说明 |
|------|-----|------|
| `isServer` | 0x0010 | 服务器模式，启用内部优化 |
| `isStructured` | 0x0020 | 结构化文件优化 |
| `canPreRead` | 0x0040 | 启用预读操作 |
| `logStats` | 0x0080 | 分离时显示统计信息 |
| `Serialized` | 0x0004 | 调用者确保 MRSW 语义 |
| `ioMTSafe` | 0x0008 | CacheIO 对象线程安全 |
| `Debug` | 0x0003 | 调试级别（0-3） |

#### 槽位状态标志 (XrdRmcSlot)
| 标志 | 值 | 说明 |
|------|-----|------|
| `lenMask` | 0x01ffffff | 提取 Count 中的真实长度 |
| `isShort` | 0x80000000 | 短页标志 |
| `inTrans` | 0x40000000 | 正在传输中 |
| `isSUSE` | 0x20000000 | 单次使用标志 |
| `isNew` | 0x10000000 | 新页（未引用） |

### 3.3 内存布局

```
缓存内存区域 (Base):
┌─────────────────────────────────────────┐
│  hTab (哈希表，用于 CacheIO 跟踪)        │  ← 占用第一个页
├─────────────────────────────────────────┤
│  Slot 0 数据页 (SegSize bytes)          │
├─────────────────────────────────────────┤
│  Slot 1 数据页 (SegSize bytes)          │
├─────────────────────────────────────────┤
│  ...                                    │
├─────────────────────────────────────────┤
│  Slot N-1 数据页 (SegSize bytes)        │
├─────────────────────────────────────────┤
│  Slash[] 哈希表 (页内容哈希)             │
└─────────────────────────────────────────┘

槽位数组 (Slots[]):
┌─────────────────────────────────────────┐
│  Slot 0 ~ SegCnt-1: 缓存页槽位          │
├─────────────────────────────────────────┤
│  Slot SegCnt ~ SegCnt+maxFiles-1:       │
│    文件槽位（用于 CacheIO 跟踪）         │
└─────────────────────────────────────────┘
```

## 4. 核心类详解

### 4.1 XrdRmc - 缓存工厂类

**文件：** `XrdRmc.hh`, `XrdRmc.cc`

**职责：** 提供缓存实例的创建入口，隐藏具体实现类型。

**关键方法：**
- `Create(Parms &Params, aprParms *aprP)` - 创建缓存实例，返回 `XrdOucCache*`

**设计模式：** 工厂模式，便于未来扩展新的缓存实现类型。

### 4.2 XrdRmcReal - 缓存核心实现

**文件：** `XrdRmcReal.hh`, `XrdRmcReal.cc`

**职责：** 实现 `XrdOucCache` 接口，管理缓存的内存分配、页表、哈希表和预读线程。

**关键成员：**
- `Base` - mmap 分配的缓存内存基址
- `Slots[]` - 槽位数组，管理缓存页和文件信息
- `Slash[]` - 哈希表，用于快速查找缓存页
- `hTab[]` - CacheIO 对象哈希表，用于跟踪已附加的文件
- `prFirst/prLast` - 预读任务队列

**关键方法：**
| 方法 | 说明 |
|------|------|
| `Attach(ioP, Opts)` | 将 CacheIO 对象附加到缓存，返回 XrdRmcData 代理 |
| `Detach(ioP)` | 从缓存分离 CacheIO 对象，回收相关槽位 |
| `Get(ioP, lAddr, rAmt, noIO)` | 获取指定逻辑地址的缓存页，未命中时触发 IO |
| `Ref(Addr, rAmt, sFlags)` | 更新缓存页的引用计数和状态 |
| `Trunc(ioP, lAddr)` | 截断指定地址之后的缓存页 |
| `Upd(Addr, wLen, wOff)` | 更新缓存页内容（写操作后调用） |
| `PreRead(prReq)` | 将预读任务加入队列 |
| `PreRead()` | 预读工作线程主循环 |

**内存管理：**
- 使用 `mmap(MAP_ANONYMOUS)` 分配匿名内存
- 页大小自动对齐到 2 的幂
- 通过 `munmap` 释放内存

### 4.3 XrdRmcData - 缓存 IO 代理

**文件：** `XrdRmcData.hh`, `XrdRmcData.cc`

**职责：** 封装 `XrdOucCacheIO` 对象，提供缓存读写操作，管理每连接的预读队列。

**关键成员：**
- `Cache` - 指向 XrdRmcReal 的指针
- `ioObj` - 原始 IO 对象
- `Statistics` - 每连接统计信息
- `rwLock` - 读写锁
- `prBeg[]/prEnd[]/prOpt[]` - 预读队列
- `prRR[]/prRRNow` - 最近读取记录（避免重复预读）

**关键方法：**
| 方法 | 说明 |
|------|------|
| `Read(Buff, Offs, rLen)` | 从缓存读取数据，自动触发预读 |
| `Write(Buff, Offs, wLen)` | 写穿透：先写底层 IO，再更新缓存 |
| `Trunc(Offs)` | 截断文件，回收相关缓存页 |
| `Detach(iocd)` | 分离操作，等待预读完成后清理 |
| `Preread()` | 执行预读队列中的任务 |
| `Preread(Offs, rLen, Opts)` | 手动添加预读请求 |
| `QueuePR(segBeg, rLen, prHow, isAuto)` | 将预读请求加入队列 |

**并发控制：**
- 使用 `MrSw` RAII 类管理 MRSW（多读单写）锁
- `pPLock/rPLock/wPLock` 分别控制预读、读、写的锁类型
- `DMutex` 保护预读队列和状态

**自动预读算法：**
1. 当读取长度 < `Trigger` 且不在最近读取记录中时触发预读
2. 预读页数 = 读取长度/页大小，最小为 `minPages`
3. 预读页面参与 LRU 淘汰（除非是 `maxiRead` 触发的单次使用预读）
4. 定期计算预读命中率，低于 `minPerf` 时禁用自动预读

### 4.4 XrdRmcSlot - 缓存槽位数据结构

**文件：** `XrdRmcSlot.hh`

**职责：** 定义缓存页的元数据和链表操作。

**关键成员：**
- `Contents/Key` - 联合体：缓存页存储逻辑地址，文件槽位存储 CacheIO 指针
- `Status` - 联合体：IO 等待队列、CacheIO 数据指针、LRU 链表、引用计数
- `Own` - 所有权链表（文件拥有哪些缓存页）
- `HLink` - 哈希链表指针
- `Count` - 引用计数和状态标志

**链表操作：**
- `Push/Pull` - LRU 链表的插入/删除
- `reRef/unRef` - 将页移到 LRU 头部/尾部
- `Owner` - 管理文件到缓存页的所有权关系
- `Find` - 在哈希链表中查找缓存页
- `Hide` - 从哈希表中移除缓存页

## 5. 模块依赖关系

### 5.1 依赖的模块

| 依赖模块 | 用途 |
|----------|------|
| `XrdOuc/XrdOucCache.hh` | 抽象缓存接口定义 |
| `XrdOuc/XrdOucCacheStats.hh` | 缓存统计信息 |
| `XrdSys/XrdSysPthread.hh` | 线程操作 |
| `XrdSys/XrdSysXSLock.hh` | 读写锁（MRSW） |
| `XrdSys/XrdSysSemaphore.hh` | 信号量同步 |
| `XrdSys/XrdSysHeaders.hh` | 系统头文件 |
| `sys/mman.h` | mmap 内存映射 |

### 5.2 依赖该模块的模块

| 依赖模块 | 文件 | 用途 |
|----------|------|------|
| `XrdPosix` | `XrdPosixConfig.cc` | 配置和创建缓存实例，用于 POSIX 文件缓存 |

## 6. 数据流程

### 6.1 读操作流程

```
应用调用 XrdRmcData::Read()
    │
    ├─ 验证偏移和长度
    │
    ├─ 检查是否需要预读
    │   └─ 是 → QueuePR() 加入预读队列
    │
    ├─ 计算段号和段内偏移
    │
    ├─ 循环获取缓存页:
    │   ├─ Cache->Get() 查找/加载缓存页
    │   │   ├─ 命中 → 返回缓存页地址
    │   │   └─ 未命中 → 从 ioObj->Read() 读取
    │   ├─ memcpy 到目标缓冲区
    │   └─ Cache->Ref() 更新引用
    │
    ├─ 更新统计信息
    │
    └─ 返回实际读取字节数
```

### 6.2 写操作流程（Write-Through）

```
应用调用 XrdRmcData::Write()
    │
    ├─ 验证写权限和偏移
    │
    ├─ ioObj->Write() 写穿透到底层 IO
    │
    ├─ 计算段号和段内偏移
    │
    ├─ 循环更新缓存页:
    │   ├─ Cache->Get() 查找缓存页
    │   ├─ 存在 → memcpy 更新内容
    │   └─ Cache->Upd() 更新引用
    │
    └─ 返回实际写入字节数
```

### 6.3 预读流程

```
触发预读（自动或手动）
    │
    ├─ QueuePR() 将请求加入队列
    │   ├─ 检查是否在最近读取记录中
    │   ├─ 检查是否已调度
    │   └─ 加入 prBeg[]/prEnd[]/prOpt[] 队列
    │
    ├─ Cache->PreRead(&prReq) 通知预读线程
    │
    └─ 预读线程:
        ├─ Preread() 取出队列任务
        ├─ Cache->Get() + Cache->Ref() 预加载页面
        └─ 更新预读统计
```

## 7. 配置参数说明

在 `XrdPosixConfig.cc` 中，缓存通过以下参数配置：

```
[cache]
cachesz    = <bytes>        # 缓存大小（默认 100MB）
pagesize   = <bytes>        # 页大小（默认 32KB，必须是 2 的幂）
max2cache  = <bytes>        # 最大缓存读取量
maxfiles   = <count>        # 最大文件数
mode       = server|client  # 服务器/客户端模式
struct     = 0|1            # 结构化文件优化
stats      = 0|1            # 显示统计信息
preread    = 0|1            # 启用预读
```

## 8. 设计特点

1. **工厂模式**：通过 `XrdRmc::Create()` 创建缓存实例，便于扩展
2. **代理模式**：`XrdRmcData` 作为 `XrdOucCacheIO` 的代理，透明地添加缓存功能
3. **内存映射**：使用 `mmap` 分配匿名内存，避免用户态/内核态拷贝
4. **哈希表加速**：通过哈希表快速查找缓存页，O(1) 时间复杂度
5. **LRU 淘汰**：使用双向链表实现 LRU，支持 O(1) 的插入和删除
6. **预读优化**：自动检测顺序读取模式，异步预读后续页面
7. **并发控制**：MRSW 锁支持多读单写，提高并发性能
8. **引用计数**：跟踪缓存页使用情况，支持智能淘汰
