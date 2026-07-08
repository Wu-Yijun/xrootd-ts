# url.test.ts — XRootDUrl Unit Tests

Source: `src/url/url.test.ts`

Module under test: `XRootDUrl` — XRootD URL parser that parses URLs of the form `root://[user:pass@]host[:port][/path]`.

---

## 1. parses full URL with host:port/path

Parses a fully-qualified URL `root://host.cern.ch:1095/data` and asserts that every component is extracted correctly:
- `protocol` is `"root"`
- `host` is `"host.cern.ch"`
- `port` is `1095`
- `path` is `"/data"`

**Edge case:** Ensures all URL components are parsed in isolation when every part is present.

## 2. uses default port 1094 when omitted

Parses `root://host.cern.ch/data` (no port specified) and asserts that `port` defaults to `1094`, which is the standard XRootD port.

**Edge case:** Default port fallback when the port segment is absent from the URL string.

## 3. parses roots:// secure protocol

Parses `roots://host.cern.ch/data` and asserts:
- `protocol` is `"roots"`
- `isSecure()` returns `true`

**Edge case:** Distinguishes secure (`roots://`) from non-secure (`root://`) protocol schemes.

## 4. parses user:pass@host:port/path

Parses `root://alice:secret@host.cern.ch:1095/data` and asserts:
- `user` is `"alice"`
- `password` is `"secret"`
- `host`, `port`, `path` are correct

**Edge case:** URL contains embedded credentials (username + password) which must be extracted without affecting host/port parsing.

## 5. throws on malformed URL

Asserts that constructing `new XRootDUrl("root://host:abc/port")` throws an exception, because `"abc"` is not a valid port number.

**Edge case:** Input validation — non-numeric port string triggers a parse error.

## 6. isValid() returns true for root and roots

Asserts `isValid()` returns `true` for both `root://h/p` and `roots://h/p`.

**Edge case:** Only `root` and `roots` are valid XRootD protocol schemes; any other scheme would presumably return `false`.

## 7. isSecure() returns true only for roots

Asserts:
- `root://h/p` → `isSecure()` is `false`
- `roots://h/p` → `isSecure()` is `true`

**Edge case:** Security flag is strictly tied to the `roots` protocol prefix.

## 8. getHostId() includes user:pass@host:port

Parses `root://alice:s3cr3t@host.cern.ch:1095/data` and asserts `getHostId()` returns `"alice:s3cr3t@host.cern.ch:1095"`.

**Edge case:** When credentials are present, the host identifier includes the full `user:pass@host:port` string.

## 9. getHostId() without auth

Parses `root://host.cern.ch/data` and asserts `getHostId()` returns `"host.cern.ch:1094"`.

**Edge case:** When no credentials are present, the host identifier is simply `host:port` (using the default port).

## 10. getChannelId() is host:port

Parses `root://host.cern.ch:1095/data` and asserts `getChannelId()` returns `"host.cern.ch:1095"`.

**Edge case:** `getChannelId()` always returns `host:port` regardless of credentials.

## 11. getLocation() is protocol://host:port/path

Parses `root://host.cern.ch:1095/data` and asserts `getLocation()` returns the full URL string `"root://host.cern.ch:1095/data"`.

**Edge case:** `getLocation()` reconstructs the complete URL from parsed components.

## 12. toString() round-trips

Parses `root://alice:pw@host.cern.ch:1095/data`, calls `toString()`, and asserts the output equals the original input.

**Edge case:** Serialization/deserialization round-trip preserves the full URL including credentials.

## 13. toString() omits default port

Parses `root://host.cern.ch/data` (default port 1094) and asserts `toString()` outputs `"root://host.cern.ch/data"` without `:1094`.

**Edge case:** Default port is not included in the serialized string to keep URLs clean.

## 14. static parse() creates instance

Calls `XRootDUrl.parse("root://host/path")` and asserts:
- The result is an instance of `XRootDUrl`
- `host` is `"host"`

**Edge case:** Static factory method produces a valid `XRootDUrl` object.

## 15. parses URL without path

Parses `root://host.cern.ch` (no path) and asserts `path` defaults to `"/"`.

**Edge case:** When the path segment is absent, it defaults to `"/"` rather than being `undefined` or empty.
