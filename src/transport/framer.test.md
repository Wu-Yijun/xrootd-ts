# framer.test.ts — Framer Unit Tests

Source: `src/transport/framer.test.ts`

Module under test: `Framer` — XRootD frame parser/buffering layer. Feeds raw byte chunks and produces complete `Frame` objects (8-byte header + body). Handles partial headers, partial bodies, and multiple concatenated frames.

Helper: `makeFrame(streamId, status, body)` constructs a raw XRootD frame buffer with an 8-byte header (streamId[2] + status[2] + dlen[4]) followed by the body.

---

## 1. parses a complete frame in one chunk

Feeds a complete 12-byte frame (8-byte header + 4-byte body) in a single `feed()` call. Asserts:
- One frame is returned
- `status` is `0`
- `dlen` is `4`
- `body` bytes match `[1, 2, 3, 4]`

**Operation:** Happy path — complete frame delivered in one piece.

## 2. parses 1-byte-at-a-time feed

Feeds a complete frame one byte at a time across 11 separate `feed()` calls. Asserts exactly one frame is parsed with `dlen === 3`.

**Boundary case:** Worst-case fragmentation — the frame parser must correctly accumulate data byte-by-byte without losing or duplicating bytes.

## 3. parses random-length chunks

Feeds a 58-byte frame (8-byte header + 50-byte body) in random-length chunks (1–10 bytes each). Asserts exactly one frame is parsed with `status === 0` and `dlen === 50`.

**Boundary case:** Verifies the parser handles arbitrary chunking of the input stream, not just uniform splits.

## 4. returns empty on incomplete header (< 8 bytes)

Feeds only 4 bytes (less than the required 8-byte header). Asserts no frames are returned (`frames.length === 0`).

**Boundary case:** The parser must wait for a full header before attempting to parse a frame.

## 5. returns empty when header ok but body pending

Feeds 18 bytes (8-byte header declaring 100-byte body + only 10 bytes of body). Asserts no frames are returned. Then feeds the remaining 90 bytes and asserts one complete frame is returned with `dlen === 100`.

**Boundary case:** When the header indicates a body size larger than what has been received, the parser must buffer and wait for the remaining bytes.

## 6. parses multiple frames concatenated in one chunk

Constructs two frames (body1 = `[1]`, body2 = `[2, 3]`) with different statuses (`0` and `4003`), concatenates them, and feeds them as one chunk. Asserts two frames are returned with correct `status` and `dlen` values.

**Operation:** Multiple complete frames in a single data chunk must all be parsed.

## 7. handles empty data feed

Feeds an empty buffer (`Buffer.alloc(0)`). Asserts no frames are returned.

**Boundary case:** Empty input should not cause errors or produce spurious frames.

## 8. handles multiple feeds building up a frame

Feeds a 12-byte frame in three arbitrary splits (5 + 5 + 2 bytes). Asserts the first two feeds return no frames, and the third feed returns one complete frame with the correct body `[0xde, 0xad, 0xbe, 0xef]`.

**Operation:** Frame assembly across multiple partial feeds — the parser must correctly accumulate and flush only when the full frame (header + body) has been received.

## 9. parses body=0 frame correctly

Feeds a frame with an empty body (8-byte header only, `dlen = 0`). Asserts one frame is returned with `dlen === 0` and `body.length === 0`.

**Boundary case:** Zero-length body is valid and must be handled without treating it as "incomplete".
