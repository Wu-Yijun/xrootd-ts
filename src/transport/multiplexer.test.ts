import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Multiplexer } from './multiplexer.ts'
import type { ITransport } from './interface.ts'
import type { Frame } from './framer.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

function extractStreamId(buf: Buffer): number {
  return (buf[0] << 8) | buf[1]
}

class MockTransport implements ITransport {
  private dataCallback: ((chunk: Buffer) => void) | null = null
  sentData: Buffer[] = []

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  destroy(): void {}

  async send(data: Buffer): Promise<void> {
    this.sentData.push(Buffer.from(data))
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.dataCallback = callback
  }

  simulateResponse(status: number, body: Buffer): void {
    if (this.dataCallback && this.sentData.length > 0) {
      const lastReq = this.sentData[this.sentData.length - 1]
      const sid = extractStreamId(lastReq)
      this.dataCallback(buildResponseFrame(sid, status, body))
    }
  }

  simulateResponseFor(streamId: number, status: number, body: Buffer): void {
    if (this.dataCallback) {
      this.dataCallback(buildResponseFrame(streamId, status, body))
    }
  }
}

describe('Multiplexer', () => {
  let transport: MockTransport
  let mux: Multiplexer

  beforeEach(() => {
    transport = new MockTransport()
    mux = new Multiplexer(transport)
  })

  afterEach(() => {
    mux.close()
  })

  it('basic request/response matching', async () => {
    const body = new Uint8Array(16)
    const responsePromise = mux.request(3006, body)

    // Simulate response after a tick
    setTimeout(() => {
      transport.simulateResponse(0, Buffer.alloc(0))
    }, 1)

    const frame = await responsePromise
    assert.equal(frame.status, 0)
    assert.equal(frame.dlen, 0)
  })

  it('multiple concurrent requests matched correctly', async () => {
    const bodies = [new Uint8Array(16), new Uint8Array(16)]
    const promises = [
      mux.request(3006, bodies[0]),
      mux.request(3007, bodies[1]),
    ]

    // Capture streamIds from sent requests and respond in reverse order
    setTimeout(() => {
      const sids = transport.sentData.map(d => extractStreamId(d))
      transport.simulateResponseFor(sids[1], 0, Buffer.alloc(0))
      transport.simulateResponseFor(sids[0], 0, Buffer.alloc(0))
    }, 1)

    const [f1, f2] = await Promise.all(promises)
    assert.equal(f1.status, 0)
    assert.equal(f2.status, 0)
  })

  it('kXR_wait (4005) triggers retry', async () => {
    mux.setTimeout(5000)
    const body = new Uint8Array(16)
    const responsePromise = mux.request(3006, body)

    setTimeout(() => {
      // First response: kXR_wait with 1 second
      transport.simulateResponse(4005, (() => {
        const b = Buffer.alloc(4)
        b.writeInt32BE(1, 0)
        return b
      })())

      // After 1 second, the retry should happen and we respond with ok
      setTimeout(() => {
        transport.simulateResponse(0, Buffer.alloc(0))
      }, 1100)
    }, 1)

    const frame = await responsePromise
    assert.equal(frame.status, 0)
  })

  it('timeout rejects pending request', async () => {
    mux.setTimeout(100) // 100ms timeout
    const body = new Uint8Array(16)
    const promise = mux.request(3006, body)

    await assert.rejects(promise, /timeout/)
  })

  it('close() rejects all pending', async () => {
    const body = new Uint8Array(16)
    const p1 = mux.request(3006, body)
    const p2 = mux.request(3007, body)

    mux.close()

    await assert.rejects(p1, /closed/)
    await assert.rejects(p2, /closed/)
  })

  it('request after close throws', async () => {
    mux.close()
    const body = new Uint8Array(16)
    await assert.rejects(
      () => mux.request(3006, body),
      /closed/,
    )
  })
})
