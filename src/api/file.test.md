# file.test.ts — File Unit Tests

Source: `src/api/file.test.ts`

Module under test: `File` — XRootD file handle abstraction providing open/read/write/close/sync/truncate operations. Manages file lifecycle and enforces state (open vs closed).

Helper: `MockTransport` uses a response queue to automatically respond to each request with pre-configured frames.

---

## 1. open() sends correct request and stores fhandle

Creates a file, enqueues an open response with `fhandle = [0xaa, 0xbb, 0xcc, 0xdd]`. Calls `file.open("/data/test.txt", { flags: 0x0010 })`. Asserts:
- `file.isOpen === true`
- At least one request was sent to the transport
- The request is a kXR_open (3010) request

Then closes the file and mux.

**Operation:** Happy path — file open sends a request and stores the returned file handle.

## 2. read() sends correct request with fhandle + offset + size

Opens a file with a known fhandle, enqueues a data response `[0xde, 0xad, 0xbe, 0xef]`. Calls `file.read(1024, 4096)`. Asserts:
- Returned data matches `[0xde, 0xad, 0xbe, 0xef]`
- The last sent request has `requestid = 3013` (kXR_read)

Then closes the file and mux.

**Operation:** Read request encodes offset and size, response data is returned.

## 3. write() sends correct request

Opens a file with a known fhandle, enqueues a success response. Calls `file.write(0, [1,2,3,4,5])`. Asserts:
- Returned `written === 5`
- The last sent request has `requestid = 3019` (kXR_write)

Then closes the file and mux.

**Operation:** Write request sends data and returns the number of bytes written.

## 4. close() sends close request and clears state

Opens a file, asserts `file.isOpen === true`. Calls `file.close()`, asserts `file.isOpen === false`.

**Operation:** Close sends a kXR_close request and resets the file's open state.

## 5. operations on closed file throw XRootDError

Attempts `file.read(0, 100)` and `file.write(0, [1])` on a file that was never opened. Asserts both reject with `XRootDError` having `code === 3004` (File not open).

**Edge case:** Read/write on a closed file must fail with the appropriate error code.

## 6. open on already-open file throws

Opens a file, then attempts `file.open("/other", ...)`. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Cannot open a file that is already open — must close first.

## 7. open error throws XRootDError

Enqueues an error response (`4003` / errnum 3011 "not found"). Attempts `file.open("/nonexistent", ...)`. Asserts rejection with `XRootDError` code `3011`.

**Error case:** Server-side open failure is propagated as `XRootDError`.

## 8. sync() sends sync request

Opens a file, calls `file.sync()`. Asserts the last sent request has `requestid = 3016` (kXR_sync).

**Operation:** Sync sends a kXR_sync request to flush data to the server.

## 9. sync() on closed file throws

Attempts `file.sync()` on a never-opened file. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Sync on a closed file must fail.

## 10. truncate() sends truncate request

Opens a file, calls `file.truncate(1024)`. Asserts the last sent request has `requestid = 3028` (kXR_truncate).

**Operation:** Truncate sends a kXR_truncate request with the target size.

## 11. truncate() on closed file throws

Attempts `file.truncate(0)` on a never-opened file. Asserts rejection with `XRootDError` code `3004`.

**Edge case:** Truncate on a closed file must fail.
