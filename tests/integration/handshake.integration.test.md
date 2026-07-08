# handshake.integration.test.ts — Handshake Integration Tests

Source: `tests/integration/handshake.integration.test.ts`

Tests the XRootD connection handshake against a real XRootD server. Validates that the handshake produces a valid session with correct sessid and protocol version, and that `XRootDClient.connect()` completes the full handshake automatically. All tests are skipped when the server is unavailable.

Infrastructure: Real TCP connection to `XROOTD_HOST:XROOTD_PORT` (default `localhost:1094`). Each test uses a 5-second timeout.

---

## 1. handshake() returns Session with valid sessid and protocolVersion

**Flow:**
1. Creates `Transport`, connects to the real server.
2. Creates `Multiplexer`.
3. Calls `handshake(mux, url)` with a 5-second timeout.

**Assertions:**
- `session` is defined
- `session.sessid` is defined and has length 16
- `session.protocolVersion > 0`

**Operation:** Happy path — the handshake function successfully negotiates with a real XRootD server and produces a valid session.

## 2. handshake() with username returns valid Session

**Flow:**
1. Creates `Transport`, connects to the real server.
2. Calls `handshake(mux, url, { username: "testuser", pid: 12345 })`.

**Assertions:**
- `session.sessid.length === 16`
- `session.protocolVersion > 0`

**Edge case:** Handshake with explicit username and PID parameters. Validates that the login request correctly includes the provided credentials.

## 3. XRootDClient.connect() completes full handshake

**Flow:**
1. Creates `XRootDClient` with the server URL.
2. Calls `client.connect()` with a 5-second timeout.

**Assertions:**
- `client.isConnected === true`

**Operation:** The high-level `XRootDClient` API completes the full handshake (protocol + login) and reports as connected.
