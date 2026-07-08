# auth.test.ts — Auth Framework Unit Tests

Source: `src/session/auth.test.ts`

Module under test: `doAuthentication()` and `registerAuthProtocol()` — The authentication framework that orchestrates multi-round authentication with XRootD servers. Selects a supported protocol, sends auth credentials, and handles authmore (4002) and error (4003) responses.

Helper: `MockTransport` simulates transport responses. `MockAuthProtocol` is a test security protocol implementation.

---

## 1. skips authentication when no protocols required

Calls `doAuthentication(mux, [], params)` with an empty list of server-supported protocols. Asserts the returned `SecEntity` has `prot === ""`.

**Edge case:** When the server requires no authentication, the framework returns immediately without sending any auth requests.

## 2. authenticates with supported protocol

Registers a `MockAuthProtocol` (name: `"host"`) that returns credentials `[0xaa, 0xbb]`. Calls `doAuthentication(mux, ["host"], params)`, simulates a successful `0` response, and asserts:
- `entity.prot === "host"`
- `entity.name === "testuser"`

**Operation:** Happy path — server advertises a supported protocol, client authenticates successfully.

## 3. throws when no supported protocol

Calls `doAuthentication(mux, ["unsupported"], params)` with no registered protocol matching `"unsupported"`. Asserts the promise is rejected with `err.code === 3030` (Authentication failed).

**Error case:** Server advertises protocols the client cannot handle.

## 4. handles multi-round authentication

Registers a `MultiRoundAuth` protocol (name: `"sss"`) that requires two rounds (returns `isComplete() === false` until called twice). The test simulates:
1. First request → `4002` (authmore)
2. Second request → `4002` (authmore)
3. Third request → `0` (success)

Asserts `entity.prot === "sss"` after the full sequence.

**Operation:** Multi-round (challenge-response) authentication where the server asks for additional rounds before accepting.

## 5. throws on auth failure

Registers a `MockAuthProtocol` (name: `"host"`), sends a request, then simulates a `4003` error response with errnum 3030 and message "Auth failed". Asserts the promise is rejected with `err.code === 3030`.

**Error case:** Server explicitly rejects the authentication attempt with an error response.
