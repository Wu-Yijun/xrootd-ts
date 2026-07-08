# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0-beta.12] - 2026-07-08

### Added

- **Pending operations tracking** in File class: `pendingOperations` counter and `isClosed` flag prevent use after close
- Pending operations tracking for all File methods: `read`, `write`, `sync`, `truncate`, `stat`
- `close()` method now checks for pending operations before closing

### Changed

- **File creates its own independent connection** instead of sharing client's multiplexer, enabling proper concurrent access per file
- Client now uses `connectToHost()` helper and passes `FileConnectionOptions` to File

### Fixed

- Use `ClientError.InternalError` instead of `ServerError.InternalError` in File operations

### Documentation

- Added detailed unit test documentation for all test files
- Added detailed e2e test documentation for all test files
- Added detailed integration test documentation for all test files

## [1.0.0-beta.11] - 2026-07-06

### Changed

- **Major code refactoring and deduplication** across the entire codebase
- Split `message.ts` into `builders.ts` + `parsers.ts` for clearer protocol separation
- Extract `sendRequest`/`extractBody`/`extractExtraData` to `utils/request.ts`
- Extract `createFrameReader` to `utils/frame-reader.ts`
- Extract `streamIdToBytes`/`strToBytes`/`bytesToStreamId` to `utils/bytes.ts`
- Extract `Message` class to `protocol/message-class.ts`
- Move `S_IFDIR`/`S_IFLNK`/`CRED_TYPE` to `protocol/constants.ts`
- Move `DEFAULT_PORT` to `protocol/constants.ts`
- Centralize response types in `protocol/types.ts`
- Relocate utility functions to `utils/` (asn1, bool, crypto)

### Removed

- Removed unused types: `FileHandle`, `FileStatus`, `RedirectInfo`, `QueryResult`, `XRootDClientOptions` (from `types.ts`)
- Removed duplicate `crc32` implementation; `sss.ts` now imports from `utils/crc32.ts`
- Deduplicated `StatInfo`, `DirectoryEntry`, `DirectoryListInfo` — unified in `api/types.ts`

### Fixed

- Replaced all hardcoded magic numbers with named constants (`RequestId`, `ServerError`, `ClientError`, `OpenFlags`)
- Improved type safety for `XRootDError` code with `ErrorCode` type
- Renamed `StatInfo.flags` to `StatInfo.mode` for clarity
- Fixed `close()`/`destroy()` deduplication in transport — `close()` now delegates to `destroy()`
- Fixed type assertion hack in handshake — added `Multiplexer.getTransport()`

## [1.0.0-beta.10] - 2026-07-06

### Added

- **SecEnv class** for parsing XRootD security environment variables (`XrdSecUSECL`, `XrdSecPROT`, etc.)
- **`loadAuthConfig()`** function for automatic credential file resolution
- **Credential auto-discovery** integration in `XRootDClient` — automatically loads SecEnv and auth config
- Export `SecEnv`, `SecEnvOptions`, `loadAuthConfig`, `AuthConfig` from index
- `updateRedirectHandler()` method on Multiplexer for dynamic redirect handling updates

### Changed

- Updated version to 1.0.0-beta.10

## [1.0.0-beta.9] - 2026-07-06

### Added

- **`protocolFilter` option** in `doAuthentication` to restrict which authentication protocols are attempted

### Fixed

- Propagate `secToken` from login response through session handshake
- Fixed `doAuthentication` to accept `string[]` instead of comma-separated string
- Renamed `authProtocols` Map to `authProtocolRegistry` to avoid parameter shadowing
- Use `needsAuth` + `authProtocols` for proper auth trigger in client
- Parse binary `secReqs`/`bifReqs` structs from server response; added `parseSecToken`

### Changed

- Updated tests for new authentication flow

## [1.0.0-beta.8] - 2026-07-06

### Fixed

- Fixed auth mock server `secToken` format and socket cleanup in e2e tests
- Added `needsAuth` to all Session mocks, fixed typecheck errors
- Fixed mock-server Docker configuration problems
- Improved integration test infrastructure with `wait-for-xrootd` script

### Changed

- Upgraded pnpm package manager
- Refactored session handling in filesystem tests for clarity
- Split `mkdir` existing-path test into mode-match and mode-mismatch cases

## [1.0.0-beta.7] - 2026-07-06

### Added

- **Kerberos 5 authentication protocol** implementation (`security/krb5.ts`)
- **Unix authentication protocol** implementation (`security/unix.ts`)
- Added `krb5` and `unix` auth support for EOS test in IHEP server

### Fixed

- Fixed Kerberos 5 authentication and redirect handling
- Fixed host authentication
- Fixed various bugs in auth and redirect flows
- Fixed `isDirectory` to use XRootD stat flags instead of POSIX mode bits

## [1.0.0-beta.6] - 2026-07-06

### Added

- Comprehensive **integration test suite** with Docker-based XRootD mock server
- Client lifecycle integration tests
- File read/write integration tests
- Filesystem mutation integration tests
- Handshake integration tests
- Type system integration tests

### Changed

- Updated version to beta.6

## [1.0.0-beta.5] - 2026-07-06

### Changed

- **Optimized request processing**: skip merged `ClientInitHandShake`
- Enhanced redirect handling with configurable maximum redirect count
- Enhanced directory list parsing to handle different response formats (normal `\n` separator vs dstat prefix detection)
- Optimized filesystem request processing with `extractExtraData` support

### Fixed

- Fixed `buildMkdirRequest` to write mode at correct protocol offset
- Fixed `buildMvRequest` to insert SPACE separator between source and target paths
- Fixed `File.read()` to handle `kXR_oksofar` (status 4000) for partial reads
- Fixed `File.write()` to return `data.length` when server `dlen` is 0
- Fixed `parseOpenResponse` to guard against short bodies (< 8 or < 12 bytes)
- Fixed group `\0` trim and readdir options

## [1.0.0-beta.4] - 2026-07-05

### Added

- **E2e test suite**: filesystem lifecycle, client redirect, authentication, error handling, read operations
- Added `DirlistOptions` constants (`Online`, `Dstat`, `Dcksm`, `Dstatx`)
- Added `cpsize`/`cptype` fields to `OpenResponse` parser

### Changed

- Rewrote `StatInfo` — flags/id/size types, added `ctime`/`atime`/`owner`/`group`, fixed `isOffline`/`isCached`
- Rewrote dirlist parsing for different response formats
- Integrated authentication into connect flow
- Renamed `AuthConfig` to `ResolvedAuthConfig` to avoid duplicate identifier

## [1.0.0-beta.3] - 2026-07-05

### Added

- Initial integration test infrastructure with Docker-based XRootD mock server
- Migration guide (`MIGRATING.md`) for v0 to v1

### Changed

- Phase 2 completion with major code formatting and style unification

## [1.0.0-beta] - 2026-07-05

### Added

- **XRootDClient** high-level client with connection management, automatic redirect handling, and authentication
- **FileSystem** class for stateless filesystem operations (stat, readdir, mkdir, rmdir, rm, mv)
- **File** extensions: `sync()` and `truncate()` methods
- **Authentication framework**: pluggable `SecurityProtocol` interface with automatic protocol negotiation
- **host authentication**: IP-based trust authentication
- **SSS authentication**: Simple Shared Secret with Blowfish-ECB encryption and CRC32 checksum
- **Automatic redirect handling**: seamless server-to-server failover with configurable `maxRedirects`
- **Complete error handling**: `XRootDError` with full server error code coverage (3000-3035)
- Protocol request builders for all P1 request codes (sync, truncate, dirlist, mkdir, rmdir, rm, mv, auth, endsess)
- Response parsers for dirlist, redirect, and wait responses
- `StatInfo` with computed properties: `isDirectory`, `isLink`, `isOffline`, `isCached`
- Type definitions: `AuthConfig`, `ClientOptions`, `DirectoryEntry`, `DirectoryList`, `OpenOptions`
- Integration tests with Docker-based XRootD mock server
- End-to-end tests for filesystem operations, authentication, redirect, and error handling
