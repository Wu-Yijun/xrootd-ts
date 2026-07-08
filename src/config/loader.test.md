# loader.test.ts — loadAuthConfig Unit Tests

Source: `src/config/loader.test.ts`

Module under test: `loadAuthConfig()` — Loads authentication configuration by merging credentials from multiple sources (options, URL userinfo, SecEnv, SSS keytab file) with a defined priority order.

---

## 1. returns empty config with no inputs

Calls `loadAuthConfig({})` with no arguments. Asserts `username`, `password`, and `sssKey` are all `undefined`.

**Operation:** Empty input produces empty config.

## 2. prefers credentials over URL

Provides both a URL with credentials (`root://urluser:urlpass@host/path`) and an explicit `credentials` option (`{ username: "optuser", password: "optpass" }`). Asserts the explicit credentials win: `username === "optuser"`, `password === "optpass"`.

**Edge case:** Explicit `credentials` option has higher priority than URL userinfo.

## 3. falls back to URL userinfo

Provides only a URL with credentials (`root://urluser:urlpass@host/path`). Asserts `username === "urluser"`, `password === "urlpass"`.

**Operation:** When no explicit credentials are provided, URL userinfo is used.

## 4. falls back to SecEnv XrdSecUSER/XrdSecCREDS

Provides a `SecEnv` with `XrdSecUSER: "envuser"` and `XrdSecCREDS: "envpass"`. Asserts `username === "envuser"`, `password === "envpass"`.

**Operation:** When no URL or explicit credentials are provided, SecEnv variables are used.

## 5. reads SSS keytab file when available

Creates a temporary file with 8 bytes of key data, sets `XrdSecSSSKT` to point to it. Asserts `sssKey` is a `Uint8Array` of length 8 matching the file contents.

**Operation:** SSS keytab file is read from disk when the path is provided via SecEnv.

## 6. returns undefined sssKey when keytab file does not exist

Sets `XrdSecSSSKT` to `/nonexistent/path/key`. Asserts `sssKey === undefined`.

**Edge case:** Missing keytab file does not throw — it gracefully returns `undefined`.

## 7. username/password defaults to undefined when all sources empty

Provides a URL without userinfo (`root://host/path`) and no other sources. Asserts `username === undefined` and `password === undefined`.

**Edge case:** When all credential sources are empty, the result fields are `undefined` rather than empty strings.
