# handshake.test.ts — Handshake Unit Tests

Source: `src/session/handshake.test.ts`

Module under test: `handshake()` — Performs the XRootD connection handshake sequence: sends ClientInitHandShake + kXR_protocol request, receives ServerInitHandShake + protocol response, then sends kXR_login and receives sessid. Returns a `Session` object with protocol version, session ID, and authentication info.

Helper: `MockTransportForHandshake` simulates the transport layer, allowing tests to emit specific response frames.

---

## 1. returns Session with correct sessid and protocolVersion

Simulates the full three-step handshake:
1. Sends `ServerInitHandShake` frame (protover=0x520, msgval=1)
2. Sends `kXR_ok` + protocol response (pval=0x520, flags=0x09)
3. Sends `kXR_ok` + login response with sessid bytes [1..16]

Asserts the resolved `Session` has:
- `protocolVersion === 0x520`
- `needsAuth === false` (no secToken in login response)
- `authProtocols === undefined`
- `sessid` is `[1, 2, ..., 16]`

**Operation:** Happy path — complete handshake produces a valid session.

## 2. sends correct handshake + protocol in first send

Simulates the same three-step handshake but inspects the **data sent** by the client. Asserts the first send is exactly 44 bytes (20-byte ClientInitHandShake + 24-byte kXR_protocol request) and verifies:
- Handshake constants: `first=0, second=0, third=0, fourth=4, fifth=2012`
- Protocol request fields: `requestid=3006` (kXR_protocol), `clientpv=0x520`

**Operation:** Validates the exact binary format of the initial handshake + protocol request message.

## 3. sends login request as second send

Simulates the handshake and inspects the second `send()` call. Asserts:
- `requestid = 3007` (kXR_login)
- `pid = 42`
- `username` field contains `"alice"` (padded to 8 bytes)

**Operation:** Validates the binary layout of the kXR_login request, including pid, username, and reserved fields.

## 4. returns authProtocols from login secToken

Simulates the handshake with a login response that includes a `secToken` of `"&P=host&P=sss"`. Asserts:
- `needsAuth === true` (secToken present)
- `authProtocols === ["host", "sss"]`

**Edge case:** The secToken is a query-string-like format where `&P=<protocol>` entries list the server's supported authentication protocols.

## 5. throws on protocol error response

Simulates the handshake but returns an error frame (`4003` / errnum 3006, message "protocol not supported") instead of the protocol response. Asserts the session promise is rejected with a message containing "Protocol handshake error".

**Error case:** Server does not support the requested protocol version.

## 6. throws on login error response

Simulates the handshake through the protocol step, then returns an error frame (`4003` / errnum 3010, "not authorized") for the login request. Asserts the session promise is rejected with a message containing "Login error".

**Error case:** Server rejects the login attempt (e.g., unauthorized).

## 7. throws on login redirect response

Simulates the handshake through the protocol step, then returns a redirect response (`4004` / port=1095, host="other.server.com") for the login request. Asserts the session promise is rejected with a message containing "redirect".

**Error case:** Server responds to login with a redirect to another server. The handshake does not follow redirects — it rejects.
