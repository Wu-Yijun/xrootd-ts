# error.test.ts — E2E Error Handling Tests

Source: `tests/e2e/error.test.ts`

Tests error propagation in real TCP scenarios: server-side protocol errors, connection drops, and request timeouts. Uses real TCP servers that simulate various failure modes.

---

## 1. kXR_error throws XRootDError

**Setup:** A real TCP server responds to:
- `kXR_protocol` (3006) → success
- `kXR_login` (3007) → success (16-byte sessid)
- `kXR_open` (3010) → 4003 error with errnum 3011 ("No such file")

**Flow:**
1. Connects, sends protocol and login manually.
2. Creates a `File` and attempts to open `/nonexistent/file.txt`.
3. The server responds with a `4003` error frame containing errnum 3011.

**Assertions:**
- The promise rejects with an `XRootDError` instance
- `err.code === 3011`
- `err.message` matches `/no such file/i`

**Operation:** Verifies that server-side kXR_error responses are properly propagated as typed `XRootDError` objects through the full stack (Transport → Multiplexer → File).

## 2. connection disconnect rejects pending request

**Setup:** A real TCP server responds normally to protocol, login, and open requests, but **destroys the socket** when it receives a `kXR_read` (3013) request.

**Flow:**
1. Connects, performs protocol + login, opens a file.
2. Calls `file.read(0, 100)` — the server receives the read request and immediately calls `socket.destroy()`.
3. The read promise should reject because the connection was severed.

**Assertions:**
- The promise rejects with an `Error` instance

**Edge case:** When the server abruptly closes the connection mid-operation, the multiplexer must reject the pending request rather than hanging forever.

## 3. timeout rejects pending request

**Setup:** A real TCP server responds to protocol and login but **never responds** to any other request (e.g., `kXR_read`). The server simply ignores the request.

**Flow:**
1. Connects, performs protocol + login.
2. Sets `mux.setTimeout(100)` (100ms timeout).
3. Sends a `kXR_read` (3013) request that the server will never answer.

**Assertions:**
- The promise rejects with an error matching `/timeout/`

**Edge case:** When the server silently drops a request, the multiplexer's timeout mechanism must eventually reject the pending request.
