# Migrating from v0 to v1

This guide helps you migrate from `xrootd-binding` (v0) to the pure TypeScript `xrootd` (v1).

## Key Differences

| Aspect | v0 (xrootd-binding) | v1 (xrootd) |
|--------|---------------------|-------------|
| Implementation | C++ native addon | Pure TypeScript |
| Node.js requirement | Any | >= 22 |
| Module system | ESM + CJS | ESM only |
| Dependencies | node-gyp-build, prebuilds | None (zero runtime deps) |
| TLS support | Via native XRootD lib | Built-in (node:tls) |
| Configuration | `Env` singleton | Constructor options |

## Installation

```bash
# v0
npm install xrootd

# v1
npm install xrootd
```

v1 requires Node.js >= 22 and has zero native dependencies.

## Import Changes

```typescript
// v0
import { File, FileSystem, CopyProcess, Env, URL } from 'xrootd';
import { OpenFlags, AccessMode, MkDirFlags } from 'xrootd';

// v1
import { XRootDClient, File, FileSystem } from 'xrootd';
import { XRootDUrl, OpenFlags } from 'xrootd';
```

## API Changes

### 1. Connection Management

v1 introduces `XRootDClient` as the primary entry point that manages connection lifecycle:

```typescript
// v0 - Direct instantiation with URL per operation
const fs = new FileSystem('root://eospublic.cern.ch');
const stat = await fs.stat('/data/file.txt');

// v1 - Client-based with explicit connect
const client = new XRootDClient('root://eospublic.cern.ch', {
  credentials: { username: 'user', password: 'pass' }, // optional
  timeout: 30000, // optional
  maxRedirects: 16, // optional
});
await client.connect();

// Use client methods
const stat = await client.stat('/data/file.txt');
await client.close();
```

### 2. File Operations

```typescript
// v0
import { File, OpenFlags } from 'xrootd';

const file = new File();
await file.open('root://server//path/to/file', OpenFlags.Read);
const buf = await file.read(0n, 1024);
await file.close();

// v1
import { XRootDClient } from 'xrootd';
import { OpenFlags } from 'xrootd';

const client = new XRootDClient('root://server');
await client.connect();

const file = await client.open('/path/to/file', { flags: OpenFlags.Read });
const buf = await file.read(0, 1024); // number instead of bigint
await file.close();
await client.close();
```

### 3. FileSystem Operations

```typescript
// v0
const fs = new FileSystem('root://server');
await fs.mkdir('/new/dir', MkDirFlags.MakePath);
await fs.mv('/old/path', '/new/path');
const entries = await fs.dirList('/data');

// v1
const client = new XRootDClient('root://server');
await client.connect();

await client.mkdir('/new/dir');
await client.mv('/old/path', '/new/path');
const dir = await client.readdir('/data'); // returns DirectoryList
await client.close();
```

### 4. URL Handling

```typescript
// v0
import { URL } from 'xrootd';
const url = new URL('root://user:pass@host:1094//path');
console.log(url.hostName, url.port, url.path);

// v1
import { XRootDUrl } from 'xrootd';
const url = XRootDUrl.parse('root://user:pass@host:1094//path');
console.log(url.host, url.port, url.path);
```

### 5. Error Handling

```typescript
// v0
import { XRootDError } from 'xrootd';
try {
  await file.open('root://server//nonexistent');
} catch (e) {
  if (e instanceof XRootDError) {
    console.log(e.code, e.status);
  }
}

// v1
import { XRootDError } from 'xrootd';
try {
  await client.open('/nonexistent');
} catch (e) {
  if (e instanceof XRootDError) {
    console.log(e.code); // ErrorCode (ServerError | ClientError)
    console.log(e.errno); // optional server error number
  }
}
```

## Removed Features

The following v0 features are **not yet available** in v1:

| Feature | v0 | v1 Status |
|---------|-----|-----------|
| `CopyProcess` | ✅ | Not implemented |
| `Env` configuration | ✅ | Not implemented (use constructor options) |
| `createReadStream` / `createWriteStream` | ✅ | Not implemented |
| Extended Attributes (XAttr) | ✅ | Not implemented |
| Vector Read | ✅ | Not implemented |
| Server-side Clone | ✅ | Not implemented |
| `statVFS` | ✅ | Not implemented |
| `ping` | ✅ | Not implemented |
| `query` / `sendInfo` / `sendCache` | ✅ | Not implemented |
| `prepare` (tape staging) | ✅ | Not implemented |
| `getProperty` / `setProperty` | ✅ | Not implemented |
| `chmod` | ✅ | Not implemented |
| `truncate` (via FileSystem) | ✅ | Not implemented |
| `deepLocate` | ✅ | Not implemented |
| `exists` / `ensureDir` | ✅ | Not implemented (sugar methods) |
| BigInt support | ✅ | Uses `number` |

## New Features in v1

| Feature | Description |
|---------|-------------|
| `XRootDClient` | High-level client with connection management |
| `registerAuthProtocol` | Pluggable authentication framework |
| `Multiplexer` | Stream multiplexing for concurrent requests |
| `Framer` | TCP frame reassembly |
| `handshake` | Low-level handshake API |
| Protocol builders/parsers | Direct access to binary protocol |
| `Transport` | Customizable transport layer |

## Low-Level API

v1 exposes the full protocol stack for advanced use cases:

```typescript
import {
  Transport,
  Multiplexer,
  Framer,
  handshake,
  buildOpenRequest,
  parseOpenResponse,
  // ... more builders/parsers
} from 'xrootd';
```

## Error Codes

v1 uses typed error codes:

```typescript
import { ServerError, ClientError, XRootDError } from 'xrootd';

// Server errors (from XRootD protocol)
throw new XRootDError(ServerError.NotFound, 'File not found');

// Client errors (library internal)
throw new XRootDError(ClientError.Uninitialized, 'Client not connected');
```

## Type Changes

| v0 Type | v1 Type | Notes |
|---------|---------|-------|
| `bigint \| number` | `number` | All offsets/sizes are `number` |
| `StatInfo.size: bigint` | `StatInfo.size: number` | |
| `StatInfo.id: string` | `StatInfo.id: number` | |
| `XRootDOkError` | `ErrorCode` | Union of `ServerError \| ClientError` |
| `DirListEntry` | `DirectoryEntry` | Simpler structure |
| `ReadStreamOptions` | N/A | Not implemented |
| `WriteStreamOptions` | N/A | Not implemented |
| `CopyJobConfig` | N/A | Not implemented |

## Migration Checklist

- [ ] Update Node.js to >= 22
- [ ] Replace `new FileSystem(url)` with `new XRootDClient(url)` + `connect()`
- [ ] Replace `new File()` with `client.open(path, options)`
- [ ] Change `bigint` literals (`0n`) to `number` (`0`)
- [ ] Update `dirList()` calls to `readdir()`
- [ ] Update URL class usage (`URL` -> `XRootDUrl`)
- [ ] Remove `Env` configuration (use constructor options)
- [ ] Remove unsupported feature calls (CopyProcess, streams, XAttr, etc.)
- [ ] Update error handling to use `ErrorCode` types
- [ ] Always call `client.close()` when done

## Need Help?

- Check the [README](./README.md) for v1 API documentation
- Open an issue at https://github.com/Wu-Yijun/xrootd-ts/issues
