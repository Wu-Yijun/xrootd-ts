# client-redirect.test.ts — E2E Client-Side Redirect Auto-Handling Tests

Source: `tests/e2e/client-redirect.test.ts`

Tests client-side redirect handling: the `onRedirect` callback in the `Multiplexer` that automatically reconnects and retries when a server responds with `kXR_redirect` (4004). Covers successful redirect, redirect loops, and redirect to unreachable servers.

Infrastructure:
- `createRedirectServer(redirectHost, redirectPort, redirectOnRequest)` — a server that responds normally to protocol but sends 4004 on a specific request ID.
- `createTargetServer(openFileHandle, readData)` — a server that handles all requests normally (protocol, login, open, read, close).

---

## 1. auto-reconnects from server A to server B on redirect

**Setup:**
- `serverA` redirects on `kXR_login` (3007) → points to `serverB`'s port.
- `serverB` handles all requests normally.

**Flow:**
1. Connects to `serverA`, creates `Multiplexer` with `maxRedirects: 3` and `onRedirect` handler.
2. Sends `kXR_protocol` → succeeds on `serverA`.
3. Sends `kXR_login` → `serverA` responds with 4004.
4. `onRedirect` fires: closes old mux/transport, connects to `serverB`, creates new mux, retries login.
5. Login succeeds on `serverB`.

**Assertions:**
- `loginFrame.status === 0` (retry succeeded)
- `host === "127.0.0.1"` and `port === serverB.port` inside `onRedirect`

**Operation:** Successful redirect from one server to another with automatic reconnection.

## 2. too many redirects rejects with error

**Setup:** A single server that **always** responds with 4004 redirect pointing back to itself (redirect loop).

**Flow:**
1. Connects, creates `Multiplexer` with `maxRedirects: 3`.
2. Protocol succeeds.
3. Login triggers redirect → `onRedirect` retries on same mux → server redirects again → …
4. After exceeding `maxRedirects`, the request is rejected.

**Assertions:**
- The promise rejects with an error matching `/redirect/i`

**Edge case:** Infinite redirect loops must be broken by the `maxRedirects` limit. The client must not loop forever.

## 3. redirect to unreachable server rejects with connection error

**Setup:** A server that redirects on login to port 1 (unreachable — nothing listens there).

**Flow:**
1. Connects, creates `Multiplexer` with `maxRedirects: 3` and `onRedirect` handler.
2. Protocol succeeds.
3. Login triggers redirect to port 1.
4. `onRedirect` attempts `transport.connect("127.0.0.1", 1)` — connection refused.
5. The catch block rejects the pending request with `"Connection to redirect target failed"`.

**Assertions:**
- The promise rejects with an `Error` instance

**Edge case:** When the redirect target is unreachable, the client must not hang — it must propagate the connection error and reject the pending request.
