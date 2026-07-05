# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-07-05

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
