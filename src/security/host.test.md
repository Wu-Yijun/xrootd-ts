# host.test.ts — HostAuth Unit Tests

Source: `src/security/host.test.ts`

Module under test: `HostAuth` — Host-based authentication protocol. Returns the client's hostname as credentials.

---

## 1. has correct name

Asserts `auth.name === "host"`.

**Operation:** Protocol identifier check.

## 2. returns hostname as credentials

Calls `auth.getCredentials(params)` with `host: "testhost.example.com"` and asserts the decoded credentials equal `"testhost.example.com"`.

**Operation:** Happy path — the hostname from params is returned as the credential.

## 3. returns "unknown" when host is empty

Calls `auth.getCredentials(params)` with `host: ""` and asserts the decoded credentials equal `"unknown"`.

**Edge case:** When the hostname is empty, a fallback value `"unknown"` is used instead.

## 4. processChallenge marks as complete

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** Host auth is single-round; processing any challenge immediately completes.

## 5. returns correct entity

Asserts `auth.getEntity()` returns `{ prot: "host", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.
