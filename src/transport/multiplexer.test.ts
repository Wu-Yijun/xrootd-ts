import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { Multiplexer } from './multiplexer.ts'
import type { ITransport } from './interface.ts'
import type { Frame } from './framer.ts'
import { ResponseStatus } from '../protocol/constants.ts'

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
  private closeCallback: (() => void) | null = null
  private errorCallback: ((err: Error) => void) | null = null
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

  onClose(callback: () => void): void {
    this.closeCallback = callback
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback
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

  simulateClose(): void {
    this.closeCallback?.()
  }

  simulateError(err: Error): void {
    this.errorCallback?.(err)
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

    await sleep(1)
    transport.simulateResponse(0, Buffer.alloc(0))

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

    await sleep(1)
    const sids = transport.sentData.map(d => extractStreamId(d))
    transport.simulateResponseFor(sids[1], 0, Buffer.alloc(0))
    transport.simulateResponseFor(sids[0], 0, Buffer.alloc(0))

    const [f1, f2] = await Promise.all(promises)
    assert.equal(f1.status, 0)
    assert.equal(f2.status, 0)
  })

  it('kXR_wait (4005) triggers retry', async () => {
    mux.setTimeout(10000)
    const body = new Uint8Array(16)
    const responsePromise = mux.request(3006, body)

    await sleep(1)
    const waitBody = Buffer.alloc(4)
    waitBody.writeInt32BE(2, 0)
    transport.simulateResponse(4005, waitBody)

    await sleep(2100)
    transport.simulateResponse(0, Buffer.alloc(0))

    const frame = await responsePromise
    assert.equal(frame.status, 0)
  })

  it('timeout rejects pending request', async () => {
    mux.setTimeout(100)
    const body = new Uint8Array(16)
    const promise = mux.request(3006, body)

    await assert.rejects(promise, /timeout/)

    await sleep(1100)
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

  describe('redirect handling', () => {
    it('redirect triggers onRedirect callback and retries', async () => {
      let redirectHost = ''
      let redirectPort = 0

      const redirectMux = new Multiplexer(transport, {
        maxRedirects: 16,
        onRedirect: async (host, port) => {
          redirectHost = host
          redirectPort = port
        },
      })

      const body = new Uint8Array(16)
      const responsePromise = redirectMux.request(3006, body)

      await sleep(1)

      // Build redirect response body: port[4] + host
      const host = 'newserver.example.com'
      const redirectBody = Buffer.alloc(4 + host.length + 1)
      redirectBody.writeInt32BE(1095, 0)
      redirectBody.write(host, 4, 'utf8')

      transport.simulateResponse(4004, redirectBody)

      // Wait for redirect to be processed and retry to happen
      await sleep(50)

      assert.equal(redirectHost, 'newserver.example.com')
      assert.equal(redirectPort, 1095)

      // The request should have been retried, simulate success
      transport.simulateResponse(0, Buffer.alloc(0))
      const frame = await responsePromise
      assert.equal(frame.status, 0)

      redirectMux.close()
    })

    it('rejects when max redirects exceeded', async () => {
      const redirectMux = new Multiplexer(transport, {
        maxRedirects: 1,
        onRedirect: async () => {},
      })

      const body = new Uint8Array(16)
      const promise = redirectMux.request(3006, body)

      await sleep(1)

      const host = 'server'
      const redirectBody = Buffer.alloc(4 + host.length + 1)
      redirectBody.writeInt32BE(1094, 0)
      redirectBody.write(host, 4, 'utf8')

      // First redirect
      transport.simulateResponse(4004, redirectBody)
      await sleep(50)

      // The retry happened, send another redirect
      transport.simulateResponse(4004, redirectBody)
      await sleep(50)

      // Third redirect should fail - need a new request
      const promise2 = redirectMux.request(3006, body)
      await sleep(1)
      transport.simulateResponse(4004, redirectBody)

      await assert.rejects(promise2, /Too many redirects/)

      redirectMux.close()
    })

    it('rejects when no onRedirect handler configured', async () => {
      const body = new Uint8Array(16)
      const promise = mux.request(3006, body)

      await sleep(1)

      const host = 'server'
      const redirectBody = Buffer.alloc(4 + host.length + 1)
      redirectBody.writeInt32BE(1094, 0)
      redirectBody.write(host, 4, 'utf8')

      transport.simulateResponse(4004, redirectBody)

      await assert.rejects(promise, /no onRedirect handler/)
    })

    it('resetRedirectCount resets counter', async () => {
      let callCount = 0
      const redirectMux = new Multiplexer(transport, {
        maxRedirects: 1,
        onRedirect: async () => { callCount++ },
      })

      const body = new Uint8Array(16)
      const host = 'server'
      const redirectBody = Buffer.alloc(4 + host.length + 1)
      redirectBody.writeInt32BE(1094, 0)
      redirectBody.write(host, 4, 'utf8')

      // First redirect
      const p1 = redirectMux.request(3006, body)
      await sleep(1)
      transport.simulateResponse(4004, redirectBody)
      await sleep(50)
      transport.simulateResponse(0, Buffer.alloc(0))
      await p1

      // Reset counter
      redirectMux.resetRedirectCount()

      // Second redirect should work
      const p2 = redirectMux.request(3006, body)
      await sleep(1)
      transport.simulateResponse(4004, redirectBody)
      await sleep(50)
      transport.simulateResponse(0, Buffer.alloc(0))
      await p2

      assert.equal(callCount, 2)

      redirectMux.close()
    })
  })
})
