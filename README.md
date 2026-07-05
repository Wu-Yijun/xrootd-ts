# xrootd

A TypeScript client library for the [XRootD](https://xrootd.org) protocol.

XRootD (eXtended ROOT Daemon) is a high-performance, fault-tolerant protocol for accessing and managing large-scale distributed storage systems. It is widely used in High Energy Physics (HEP) for data access at facilities like CERN's LHC experiments.

## Installation

```sh
npm install xrootd
```

## Quick Start

```ts
import { XRootDClient } from 'xrootd'

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

await client.close()
```

```ts
import { File, OpenFlags } from 'xrootd'

// Low-level API: open and read a file directly
const file = new File('root://server.example.com//data/file.dat')
await file.open({ flags: OpenFlags.Read })
const data = await file.read(0, 1024)
await file.close()
console.log(data) // Uint8Array
```

## API

### XRootDClient

High-level client that manages connection, authentication, and automatic redirect handling.

```ts
import { XRootDClient } from 'xrootd'

const client = new XRootDClient('root://server.example.com', {
  credentials: { username: 'user', password: 'pass' },
  timeout: 30000,
  maxRedirects: 16,
})

await client.connect()

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

// Metadata
const info = await client.stat('/data/file.dat')

await client.close()
```

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
import { FileSystem } from 'xrootd'

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
import { XRootDError } from 'xrootd'

try {
  await file.open('root://server//nonexistent', { flags: OpenFlags.Read })
} catch (err) {
  if (err instanceof XRootDError) {
    console.log(err.code)     // 3011 (kXR_NotFound)
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
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

interface DirectoryList {
  name: string
  entries: DirectoryListInfo[]
}

const enum OpenFlags {
  Read     = 0x0010,
  Write    = 0x0020,
  Append   = 0x0200,
  New      = 0x0008,
  Delete   = 0x0002,
  Mkpath   = 0x0100,
  Replica  = 0x0800,
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
