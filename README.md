# xrootd

A TypeScript client library for the [XRootD](https://xrootd.org) protocol.

XRootD (eXtended ROOT Daemon) is a high-performance, fault-tolerant protocol for accessing and managing large-scale distributed storage systems. It is widely used in High Energy Physics (HEP) for data access at facilities like CERN's LHC experiments.

## Installation

```sh
npm install xrootd
```

## Quick Start

```ts
import { File, OpenFlags } from 'xrootd'

// Open and read a file
const file = new File('root://server.example.com//data/file.dat')
await file.open({ flags: OpenFlags.Read })
const data = await file.read(0, 1024)
await file.close()
console.log(data) // Uint8Array
```

```ts
import { FileSystem } from 'xrootd'

// List directory contents
const fs = new FileSystem('root://server.example.com')
const entries = await fs.readdir('/data')
for (const entry of entries) {
  console.log(entry.name, entry.size)
}
```

## API

### File

File operations for reading, writing, and managing files on XRootD servers.

```ts
const file = new File('root://server//path/to/file')

// Open — two signatures
await file.open({ flags: OpenFlags.Read })
await file.open('root://server//other/file', { flags: OpenFlags.Write })

// Core operations
const data: Uint8Array = await file.read(offset, size)
const written: number = await file.write(offset, data)
const info: StatInfo = await file.stat()
await file.sync()
await file.truncate(size)
await file.close()

// Automatic resource cleanup (recommended)
await using file = new File('root://server//path/to/file')
await file.open({ flags: OpenFlags.Read })
const buf = await file.read(0, 1024)
// Automatically closes when leaving scope
```

#### Vector I/O

Batch multiple read/write operations in a single network round-trip:

```ts
const chunks = [
  { fhandle, offset: 0, rlen: 1024 },
  { fhandle, offset: 4096, rlen: 2048 },
]
const results = await file.vectorRead(chunks)
```

### FileSystem

Stateless filesystem metadata operations:

```ts
const fs = new FileSystem('root://server')

// Metadata
const info = await fs.stat('/data/file.dat')
console.log(info.size, info.mtime, info.isDirectory)

// Directory operations
await fs.mkdir('/new/dir')
const list = await fs.readdir('/data')
await fs.rename('/old/path', '/new/path')
await fs.rm('/old/file')
await fs.rmdir('/old/dir')

// Queries
const stats = await fs.query('stats')
await fs.ping()
```

### Error Handling

All errors are thrown as `XRootDError` instances:

```ts
import { XRootDError } from 'xrootd'

try {
  await file.open('root://server//nonexistent', { flags: OpenFlags.Read })
} catch (err) {
  if (err instanceof XRootDError) {
    console.log(err.code)     // 3011 (kXR_NotFound)
    console.log(err.message)  // "File not found"
    console.log(err.errno)    // POSIX errno (ENOENT)
  }
}
```

### Types

```ts
interface StatInfo {
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
}

interface DirectoryList {
  name: string
  entries: DirectoryListInfo[]
}

const enum OpenFlags {
  Read   = 0x0010,
  Write  = 0x0020,
  Append = 0x0200,
  New    = 0x0008,
  Delete = 0x0002,
}
```

## Architecture

The library uses a three-layer architecture, simplified from the original C++ XrdCl's five-layer design:

```
┌──────────────────────────────────────────────┐
│  Layer 3: Multiplexer                        │
│  streamid → Promise 映射、超时管理             │
├──────────────────────────────────────────────┤
│  Layer 2: Framer                             │
│  TCP 粘包/半包处理、Header+Body 帧切割         │
├──────────────────────────────────────────────┤
│  Layer 1: Transport                          │
│  封装 net.Socket，二进制数据收发               │
└──────────────────────────────────────────────┘
```

| C++ 原版 | TypeScript |
|----------|-----------|
| 138 个文件, ~15,000 行 | ~15 个文件, ~2,000 行 |
| 回调 + 状态机 | async/await |
| 错误码检查 | throw XRootDError |
| 5 层抽象 | 3 层精简架构 |

## Development

### Prerequisites

- Node.js >= 22
- pnpm

### Setup

```sh
pnpm install
```

### Mock Server

A Docker-based XRootD mock server is available for integration testing:

```sh
# Start mock server
pnpm mock-server:up

# Verify it's running
pnpm mock-server:verify

# View logs
pnpm mock-server:logs

# Stop
pnpm mock-server:down
```

### Build

```sh
pnpm build
```

### Type Check

```sh
pnpm typecheck
```

### Test

```sh
pnpm test
```

## Documentation

- [Migration Design](docs/migration.md) — Full protocol analysis and architecture design
- [TypeScript API Design](docs/typescript-design.md) — Detailed API specifications
- [Work Plan](docs/work-plan.md) — Implementation roadmap
- [Rust Future Optimizations](docs/rust-future-optimizations.md) — Performance optimizations deferred to Rust version

## License

This project is licensed under the [GNU Lesser General Public License v3.0 or later](LICENSE).

This is an independent TypeScript implementation of the XRootD protocol. The original XRootD project is developed by the Board of Trustees of the Leland Stanford, Jr. University and is licensed under LGPL-3.0-or-later.
