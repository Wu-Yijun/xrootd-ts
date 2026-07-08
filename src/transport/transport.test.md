# transport.test.ts — Transport Unit Tests

Source: `src/transport/transport.test.ts`

Module under test: `Transport` — Low-level TCP transport that wraps `net.Socket` for sending and receiving raw bytes over a TCP connection.

Helper: `createEchoServer()` creates a local TCP server that echoes back any data it receives.

---

## 1. connects to a TCP server

Creates a local echo server, instantiates a `Transport`, calls `transport.connect("127.0.0.1", port)`, and asserts the connection succeeds without error. The transport is then closed and the server is torn down.

**Operation:** Basic TCP connection establishment.

## 2. sends and receives data

Creates a local echo server, connects a `Transport`, registers an `onData` callback, sends `Buffer.from("Hello, XRootD!")`, and asserts the received data matches the sent data exactly.

**Operation:** Round-trip data integrity — verify that bytes sent are the same bytes received from an echo server.

## 3. close destroys the socket

Creates a local echo server, connects a `Transport`, calls `transport.close()`, then attempts to send data. Asserts that the send throws an `Error` because the socket has been destroyed.

**Boundary case:** Sending data after a graceful close must fail. Verifies that `close()` properly tears down the underlying socket.

## 4. destroy destroys the socket

Creates a local echo server, connects a `Transport`, calls `transport.destroy()` (immediate destruction), then attempts to send data. Asserts that the send throws an `Error`.

**Boundary case:** Sending data after `destroy()` must fail. Verifies that `destroy()` immediately invalidates the socket, similar to `close()` but non-graceful.

## 5. handles multiple send/receive cycles

Creates a local echo server, connects a `Transport`, then sends three messages (`"first"`, `"second"`, `"third"`) with small delays between each. Accumulates all received chunks and asserts the concatenated result equals `"firstsecondthird"`.

**Boundary case:** Verifies that the transport correctly handles interleaved send/receive operations and that data from multiple sends is not lost or corrupted when received in sequence.
