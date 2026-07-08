# multiplexer.test.ts — Multiplexer Unit Tests

Source: `src/transport/multiplexer.test.ts`

Module under test: `Multiplexer` — Multiplexes multiple logical XRootD request/response streams over a single transport connection using stream IDs. Handles request matching, timeouts, kXR_wait/kXR_waitresp retries, and redirect responses.

Helper: `MockTransport` simulates a transport layer by capturing sent data and programmatically generating responses with specific stream IDs.

---

## Basic Request/Response Matching

### 1. basic request/response matching

Sends a single request via `mux.request(3006, body)`, simulates a response on the same stream ID with status `0`, and asserts the returned frame has `status === 0` and `dlen === 0`.

**Operation:** Verifies the core multiplexing mechanism — a request gets a response matched by stream ID.

### 2. multiple concurrent requests matched correctly

Sends two concurrent requests (`3006` and `3007`), extracts the stream IDs from the sent data, then responds to them **out of order** (responding to the second request first). Asserts both promises resolve with `status === 0`.

**Operation:** Concurrent request handling — responses must be matched to the correct pending request by stream ID regardless of arrival order.

## kXR_wait / kXR_waitresp Retry Mechanism

### 3. kXR_wait (4005) triggers retry

Sets a 10-second timeout, sends a request, and simulates a `4005` (kXR_wait) response with a 2-second wait body. After waiting ~2.1 seconds, simulates a successful `0` response. Asserts the final frame has `status === 0`.

**Operation:** The multiplexer should automatically retry after receiving a kXR_wait response, waiting the server-specified duration before resending.

### 4. kXR_waitresp (4006) triggers retry

Same as above but with `4006` (kXR_waitresp) response code. Verifies that kXR_waitresp also triggers the automatic retry mechanism.

**Operation:** kXR_waitresp is another wait-type response that should trigger the same retry behavior as kXR_wait.

## Timeout and Close

### 5. timeout rejects pending request

Sets a 100ms timeout, sends a request, and asserts the promise is rejected with an error matching `/timeout/`.

**Boundary case:** When no response arrives within the configured timeout, the pending request must be rejected.

### 6. close() rejects all pending

Sends two concurrent requests, immediately calls `mux.close()`, and asserts both promises are rejected with errors matching `/closed/`.

**Boundary case:** When the multiplexer is closed, all pending requests must be rejected.

### 7. request after close throws

Calls `mux.close()` first, then attempts to send a new request. Asserts the promise is rejected with an error matching `/closed/`.

**Boundary case:** New requests cannot be created after the multiplexer has been closed.

## Redirect Handling

### 8. redirect detaches pending and passes to onRedirect

Creates a new multiplexer with an `onRedirect` callback. Sends a request, simulates a `4004` redirect response pointing to `newserver.example.com:1095`. Asserts:
- `onRedirect` is called with the correct host and port
- The pending request info (requestId, body, data) is passed to the handler
- The retried request (resubmitted inside the handler) succeeds with `status === 0`

**Operation:** Redirect response (4004) must detach the pending request from the multiplexer and pass it to the configured `onRedirect` handler, which can then re-issue the request.

### 9. rejects when no onRedirect handler configured

Sends a request on a multiplexer without an `onRedirect` handler, simulates a `4004` redirect response, and asserts the promise is rejected with an error matching `/no onRedirect handler/`.

**Boundary case:** When no redirect handler is configured, redirect responses must cause the request to fail.

### 10. redirect count increments and can be reset

Creates a multiplexer with `maxRedirects: 10`. Triggers two separate redirect sequences, calling `resetRedirectCount()` between them. Asserts `callCount` increments correctly (once per redirect) and that both requests succeed.

**Operation:** The redirect counter tracks cumulative redirects across requests and can be manually reset.

### 11. redirectCount can be initialized from options

Creates a multiplexer with `redirectCount: 1` and `maxRedirects: 2`. The first redirect increments count from 1 to 2 (succeeds). The second redirect would exceed `maxRedirects`, so it is rejected with `/Too many redirects/`.

**Boundary case:** Initial redirect count from options is respected, and exceeding `maxRedirects` triggers rejection.
