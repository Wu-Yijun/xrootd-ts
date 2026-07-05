# xrootd

A TypeScript client library for the [XRootD](https://xrootd.org) protocol.

XRootD (eXtended ROOT Daemon) is a high-performance, fault-tolerant protocol for accessing and managing large-scale distributed storage systems. It is widely used in High Energy Physics (HEP) for data access at facilities like CERN's LHC experiments.

> **🚀 v2.0.0 is Here: A Modern, Native Rewrite!**
> ⚠️ **Breaking Changes**: Because of the fundamental architecture shift, **v2 is not API-compatible with v1**.
> Please read our [Migration Guide (MIGRATING.md)](MIGRATING.md) to upgrade.

## Installation

```sh
npm install xrootd
```

## Quick Start

```ts
import { XRootDClient, OpenFlags } from 'xrootd'

const client = new XRootDClient('root://server.example.com')
await client.connect()

// List directory contents
const list = await client.readdir('/data')
for (const entry of list.entries) {
  console.log(entry.name, entry.size)
}

// Read a file
const file = await client.open('/data/file.dat')
const data = await file.read(0, 1024)
await file.close()

// Write a file
const file2 = await client.open('/data/output.dat', { flags: OpenFlags.Write | OpenFlags.New })
await file2.write(0, new Uint8Array([72, 101, 108, 108, 111]))
await file2.close()

await client.close()
```

## API

### XRootDClient

High-level client that manages connection, authentication, and automatic redirect handling.

```ts
import { XRootDClient, OpenFlags } from 'xrootd'

const client = new XRootDClient('root://server.example.com', {
  credentials: { username: 'user', password: 'pass' },
  timeout: 30000,
  maxRedirects: 16,
})

await client.connect()

// Connection state
console.log(client.isConnected)  // boolean
console.log(client.location)     // "root://server.example.com:1094/"

// File operations
const file = await client.open('/data/file.dat', { flags: OpenFlags.Read })
const data = await file.read(0, 1024)
await file.close()

// Filesystem operations
await client.mkdir('/new/dir')
const list = await client.readdir('/data')
await client.mv('/old/path', '/new/path')
await client.rm('/old/file')
await client.rmdir('/old/dir')

// Metadata — two approaches
const info1 = await client.stat('/data/file.dat')          // opens + stats + closes
const info2 = await client.statFilesystem('/data/file.dat') // filesystem protocol, no file open

await client.close()
```

### File

File operations for reading, writing, and managing files on XRootD servers.

Obtained via `client.open()` — do not construct directly.

```ts
// Open a file
const file = await client.open('/data/file.dat', { flags: OpenFlags.Read })

// Core operations
const data: Uint8Array = await file.read(offset, size)
const written: number = await file.write(offset, data)
const info: StatInfo = await file.stat()
await file.sync()
await file.truncate(size)
await file.close()
```

### FileSystem

Stateless filesystem metadata operations:

```ts
import { FileSystem } from 'xrootd'

// Obtained internally by XRootDClient; shown here for reference
const fs = new FileSystem(mux)

// Metadata
const info = await fs.stat('/data/file.dat')
console.log(info.size, info.mtime, info.isDirectory)

// Directory operations
await fs.mkdir('/new/dir')
const list = await fs.readdir('/data')
await fs.mv('/old/path', '/new/path')
await fs.rm('/old/file')
await fs.rmdir('/old/dir')
```

### Authentication

XRootD supports multiple authentication mechanisms. The library automatically negotiates the best available protocol during handshake.

#### Supported Protocols

| Protocol | Description |
|----------|-------------|
| `host` | Host-based trust authentication (IP whitelist) |
| `sss` | Simple Shared Secret (Blowfish-ECB encrypted password) |

#### Configuration

```ts
import { XRootDClient } from 'xrootd'

// host authentication (server trusts client by IP)
const client = new XRootDClient('root://server.example.com', {
  credentials: { username: 'user' },
})

// SSS authentication (shared secret)
const client = new XRootDClient('root://server.example.com', {
  credentials: {
    username: 'user',
    password: 'shared-secret',
  },
})

await client.connect()
```

When connecting to a server that requires authentication, the client will automatically:

1. Receive the server's supported authentication protocols (`secReqs`)
2. Select the first matching protocol from the list
3. Execute the authentication handshake (including multi-round `kXR_authmore` challenges)

### Error Handling

All errors are thrown as `XRootDError` instances:

```ts
import { XRootDClient, OpenFlags, XRootDError } from 'xrootd'

const client = new XRootDClient('root://server.example.com')
await client.connect()

try {
  const file = await client.open('/nonexistent', { flags: OpenFlags.Read })
  await file.read(0, 1024)
  await file.close()
} catch (err) {
  if (err instanceof XRootDError) {
    console.log(err.code)     // 3011 (NotFound)
    console.log(err.message)  // "File not found"
    console.log(err.errno)    // POSIX errno (if applicable)
  }
}
```

#### Common Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 3010 | `NotAuthorized` | Permission denied |
| 3011 | `NotFound` | File or directory not found |
| 3016 | `IsDirectory` | Expected file, got directory |
| 3018 | `ItExists` | File already exists (e.g. mkdir on existing path) |
| 3030 | `AuthFailed` | Authentication failed |

#### Client-side Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 309 | `Timeout` | Request timed out |
| 312 | `Disconnected` | Connection closed unexpectedly |
| 315 | `TooManyRedirs` | Exceeded maximum redirect count |

### Types

```ts
interface StatInfo {
  id: string        // opaque device id (string to avoid precision loss)
  size: bigint      // file size in bytes (bigint for >4GB files)
  flags: number     // XRootD server flags
  mtime: number     // modification time (epoch seconds)
  ctime: number     // change time (epoch seconds)
  atime: number     // access time (epoch seconds)
  mode: number      // POSIX mode (e.g. 0o100644)
  owner: string     // file owner
  group: string     // file group
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

interface DirectoryEntry {
  name: string
  size: number
  flags: number
  mtime: number
}

interface DirectoryList {
  name: string
  entries: DirectoryEntry[]
}

const enum OpenFlags {
  Compress  = 0x0001,
  Delete    = 0x0002,
  Force     = 0x0004,
  New       = 0x0008,
  Read      = 0x0010,
  Write     = 0x0020,
  Async     = 0x0040,
  Refresh   = 0x0080,
  Mkpath    = 0x0100,
  Append    = 0x0200,
  Retstat   = 0x0400,
  Replica   = 0x0800,
  Posc      = 0x1000,
  Nowait    = 0x2000,
  Seqio     = 0x4000,
  Wrto      = 0x8000,
}
```

#### OpenOptions

```ts
interface OpenOptions {
  flags?: OpenFlags   // file open flags (default: OpenFlags.Read)
  mode?: number       // POSIX mode (default: 0)
  signal?: AbortSignal  // cancellation signal
}
```

#### StatFlags

```ts
const StatFlags = {
  XBitSet: 1,
  IsDir: 2,
  Other: 4,
  Offline: 8,
  Readable: 16,
  Writable: 32,
  POSCPending: 64,
  BackUpExists: 128,
  CacheResp: 512,
}
```

### Redirect Handling

The client automatically handles server redirects. When a server responds with `kXR_redirect`, the client:

1. Closes the current connection
2. Connects to the new target server
3. Re-executes the handshake and authentication
4. Retries the original request

```ts
const client = new XRootDClient('root://server.example.com', {
  maxRedirects: 16, // default
})
```

## Architecture

The library uses a three-layer architecture, simplified from the original C++ XrdCl's five-layer design:

```
┌──────────────────────────────────────────────────┐
│  Layer 3: Multiplexer                            │
│  streamId → Promise mapping, timeout management  │
│  + automatic redirect interception               │
├──────────────────────────────────────────────────┤
│  Layer 2: Framer                                 │
│  TCP packet reassembly, Header+Body framing      │
├──────────────────────────────────────────────────┤
│  Layer 1: Transport                              │
│  net.Socket wrapper, binary data I/O             │
└──────────────────────────────────────────────────┘
```

| C++ Original | TypeScript |
|--------------|-----------|
| 138 files, ~15,000 lines | ~25 files, ~3,000 lines |
| Callbacks + state machines | async/await |
| Error code checking | throw XRootDError |
| 5-layer abstraction | 3-layer streamlined architecture |
| Multiple auth plugins | Pluggable SecurityProtocol interface |

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
- [Phase 2 Plan](docs/phase2.md) — Complete API, fault tolerance, and authentication
- [Rust Future Optimizations](docs/rust-future-optimizations.md) — Performance optimizations deferred to Rust version

## License

This project is licensed under the [GNU Lesser General Public License v3.0 or later](LICENSE).

This is an independent TypeScript implementation of the XRootD protocol. The original XRootD project is developed by the Board of Trustees of the Leland Stanford, Jr. University and is licensed under LGPL-3.0-or-later.
