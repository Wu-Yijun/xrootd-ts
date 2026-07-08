# sss.test.ts — SSSAuth Unit Tests

Source: `src/security/sss.test.ts`

Module under test: `SSSAuth` — Simple Shared Secret authentication protocol. Encrypts credentials using Blowfish with an 8-byte shared key.

---

## 1. has correct name

Asserts `auth.name === "sss"`.

**Operation:** Protocol identifier check.

## 2. throws on invalid key length

Asserts that constructing `new SSSAuth(Buffer.from([0x01, 0x02]))` throws an error matching `/SSS key must be 8 bytes/`.

**Edge case:** The SSS protocol requires exactly an 8-byte key. Any other length is rejected at construction time.

## 3. isSupported() returns whether Blowfish is available

Asserts `SSSAuth.isSupported()` returns a `boolean`.

**Operation:** Runtime capability check — Blowfish may not be available in all Node.js builds.

## 4. processChallenge marks as complete

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** SSS auth is single-round; processing any challenge immediately completes.

## 5. returns correct entity

Asserts `auth.getEntity()` returns `{ prot: "sss", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.

## 6. returns encrypted credentials (conditional: Blowfish supported)

Calls `auth.getCredentials(params)` with a valid key and asserts:
- `creds.length > 0`
- `creds.length % 8 === 0` (Blowfish block size alignment)

**Operation:** Credentials are encrypted with Blowfish, producing output that is a multiple of 8 bytes.

## 7. different passwords produce different credentials (conditional)

Creates two `SSSAuth` instances with the same key, calls `getCredentials` with different passwords (`"secret"` vs `"different"`), and asserts the credential arrays differ.

**Operation:** Different passwords must produce different encrypted outputs (verifying encryption is working).

## 8. sets username in entity (conditional)

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** Entity name is populated after `getCredentials` is called.

## 9. handles empty password (conditional)

Calls `auth.getCredentials(params)` with `password: ""` and asserts:
- `creds.length > 0`
- `creds.length % 8 === 0`

**Edge case:** Empty password should still produce valid encrypted credentials without errors.

> **Note:** Tests 6–9 are conditionally skipped (with `it.skip`) when Blowfish is not supported in the Node.js runtime.
