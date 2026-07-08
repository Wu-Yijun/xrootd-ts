# krb5.test.ts — Krb5Auth Unit Tests

Source: `src/security/krb5.test.ts`

Module under test: `Krb5Auth` — Kerberos 5 authentication protocol. Obtains a Kerberos ticket and returns it as credentials prefixed with `"krb5"`.

---

## 1. has correct name

Asserts `auth.name === "krb5"`.

**Operation:** Protocol identifier check.

## 2. isSupported() returns whether kerberos package is available

Asserts `Krb5Auth.isSupported()` returns a `boolean`.

**Operation:** Runtime capability check — the `kerberos` npm package may not be installed.

## 3. processChallenge marks as complete

Asserts `auth.isComplete()` is `false` initially. Calls `auth.processChallenge(empty)`, then asserts `isComplete()` is `true` and response length is 0.

**Operation:** Krb5 auth is single-round; processing any challenge immediately completes.

## 4. returns correct entity

Asserts `auth.getEntity()` returns `{ prot: "krb5", uid: 0, gid: 0 }`.

**Operation:** Security entity has the correct protocol name and default uid/gid.

## 5. returns credentials with krb5 prefix (conditional: Kerberos available)

Calls `auth.getCredentials(params)` and decodes the first 4 bytes. Asserts they equal `"krb5"`.

**Operation:** Credentials must be prefixed with the protocol identifier string.

## 6. credentials include kerberos token (conditional)

Calls `auth.getCredentials(params)` and asserts `creds.length > 4` (prefix + actual token).

**Operation:** Kerberos credentials contain more than just the 4-byte prefix.

## 7. sets username in entity after getCredentials (conditional)

Calls `auth.getCredentials(params)` with `username: "testuser"`, then asserts `auth.getEntity().name === "testuser"`.

**Edge case:** Entity name is populated after `getCredentials` is called.

> **Note:** Tests 5–7 are conditionally skipped (with `it.skip`) when the Kerberos package is not available.
