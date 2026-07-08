# read.test.ts — E2E Read Flow Tests

Source: `tests/e2e/read.test.ts`

Tests the complete XRootD read workflow: protocol negotiation → login → open → read → close. Uses a simulated XRootD server that handles the full handshake sequence including the merged ClientInitHandShake + kXR_protocol initial message.

Infrastructure: `createSimulatedServer()` creates a real TCP server that:
- Detects the merged 44-byte ClientInitHandShake + kXR_protocol message and responds with ServerInitHandShake + protocol response.
- Handles `kXR_login` (3007) with a 16-byte sessid.
- Handles `kXR_open` (3010) with a 4-byte file handle `[0xaa, 0xbb, 0xcc, 0xdd]`.
- Handles `kXR_read` (3013) with `"Hello, XRootD!"`.
- Handles `kXR_close` (3003) with success.
- Returns error 3006 for unrecognized requests.

---

## 1. completes login → open → read → close

**Flow (manual protocol/login steps):**
1. Creates `Transport`, connects to the simulated server.
2. Creates a `Multiplexer`.
3. Sends `kXR_protocol` (3006) → asserts status 0.
4. Sends `kXR_login` (3007) → asserts status 0, extracts 16-byte sessid.
5. Constructs a `Session` object with `sessid`, `protocolVersion: 0x520`, `needsAuth: false`.
6. Creates a `File` with the session.
7. Opens `/data/test.txt` with `flags: 0x0010` (read) → asserts `file.isOpen === true`.
8. Reads 100 bytes from offset 0 → asserts decoded text is `"Hello, XRootD!"`.
9. Closes the file → asserts `file.isOpen === false`.
10. Closes mux and transport.

**Assertions:**
- Protocol and login succeed
- File opens successfully
- Read data matches expected content
- File closes cleanly

**Operation:** End-to-end read path using manual protocol/login steps.

## 2. completes handshake() → open → read → close

**Flow (using `handshake()` function):**
1. Creates `Transport`, connects to the simulated server.
2. Creates a `Multiplexer`.
3. Constructs an `XRootDUrl` pointing to the server.
4. Calls `handshake(mux, url)` which performs the full handshake automatically.
5. Asserts `session.sessid.length === 16` and `session.protocolVersion > 0`.
6. Creates a `File` with the session.
7. Opens `/data/test.txt` → asserts open.
8. Reads 100 bytes → asserts `"Hello, XRootD!"`.
9. Closes → asserts closed.

**Assertions:**
- `handshake()` correctly negotiates protocol and login
- Session has valid sessid (16 bytes) and protocol version
- File read works identically to the manual flow

**Edge case:** Validates that the `handshake()` helper function correctly handles the merged ClientInitHandShake + kXR_protocol message from the server, and produces a usable session for subsequent file operations.
