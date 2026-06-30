# @xrootd/client

A TypeScript client library for the [XRootD](https://xrootd.org) protocol.

XRootD (eXtended ROOT Daemon) is a high-performance, fault-tolerant protocol for accessing and managing large-scale distributed storage systems. It is widely used in High Energy Physics (HEP) for data access at facilities like CERN's LHC experiments.

## Installation

```sh
npm install @xrootd/client
```

## Quick Start

```ts
import { XRootDClient } from "@xrootd/client";

const client = new XRootDClient("root://server.example.com");

// Open a file
const file = await client.open("/path/to/file");

// Read data
const data = await file.read(offset, length);

// Close the file
await file.close();
```

## Protocol Reference

This library implements the XRootD protocol as specified in the
[XRootD protocol specification](https://xrootd.org/doc/man1/xrootdProtocol-1.html).

### Supported Operations

- `kXR_auth` - Authentication
- `kXR_query` - Query server capabilities
- `kXR_open` - Open a file
- `kXR_close` - Close a file
- `kXR_read` - Read data
- `kXR_write` - Write data
- `kXR_sync` - Synchronize file data
- `kXR_stat` - Get file status
- `kXR_truncate` - Truncate a file
- `kXR_mkdir` - Create a directory
- `kXR_mvr` - Move/rename a file
- `kXR_rmdir` - Remove a directory
- `kXR_rm` - Remove a file
- `kXR_chmod` - Change file permissions
- `kXR_prepare` - Prepare files for access
- `kXR_set` - Set server parameters
- `kXR_getfile` - Get a file
- `kXR_putfile` - Put a file
- `kXR_multipart` - Multi-part I/O
- `kXR_redirect` - Server redirection

## Development

### Prerequisites

- Node.js >= 22
- pnpm

### Setup

```sh
pnpm install
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

## License

This project is licensed under the [GNU Lesser General Public License v3.0 or later](LICENSE).

This is an independent TypeScript implementation of the XRootD protocol. The original XRootD project is developed by the Board of Trustees of the Leland Stanford, Jr. University and is licensed under LGPL-3.0-or-later.
