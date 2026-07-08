# unix.test.ts — UnixAuth Unit Tests

Source: `src/security/unix.test.ts`

Module under test: `UnixAuth` — Unix socket-based authentication protocol. Returns credentials in the format `unix\0<username>\0<group>`.

---

## 1. has correct name

Asserts `auth.name === "unix"`.

**Operation:** Protocol identifier check.

## 2. returns credentials with unix prefix

Calls `auth.getCredentials(params)` and decodes the result. Asserts the decoded string starts with `"unix\0"`.

**Operation:** The credential format must begin with the null-terminated protocol identifier.

## 3. includes username and group in credentials

Calls `auth.getCredentials(params)` with `username: "testuser"`. Asserts the decoded credentials contain `"testuser"`.

**Operation:** The username from auth params is embedded in the credential payload.

## 4. uses provided username

Calls `auth.getCredentials(params)` with `username: "alice"`. Asserts the decoded credentials contain `"alice"`.

**Operation:** Different usernames produce different credential payloads.

## 5. falls back to unknown when no username

Calls `auth.getCredentials(params)` with `username: undefined`. Asserts the decoded string still starts with `"unix\0"`.

**Edge case:** When no username is provided, the credential is still well-formed (uses a fallback).

## 6. processChallenge marks as complete

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and the response has length 0.

**Operation:** After processing any challenge, the Unix auth protocol is immediately complete (single round).

## 7. returns correct entity

Asserts `auth.getEntity()` returns `{ prot: "unix", uid: 0, gid: 0 }`.

**Operation:** The security entity has the correct protocol name and default uid/gid values.

## 8. sets username in entity after getCredentials

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** The entity's `name` field is populated after `getCredentials` is called, not before.
