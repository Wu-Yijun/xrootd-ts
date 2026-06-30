import type { ITransport } from './interface.ts'
import { Framer, type Frame } from './framer.ts'
import { Message } from '../protocol/message.ts'
import { ResponseStatus } from '../protocol/constants.ts'

interface PendingRequest {
  resolve: (frame: Frame) => void
  reject: (err: Error) => void
  expiresAt: number
  requestId: number
  body: Uint8Array
  data?: Uint8Array
}

/**
 * Layer 3 Multiplexer
 *
 * Maintains streamId → Promise mapping.
 * Generates incremental stream IDs, stores pending requests in Map,
 * resolves when Framer delivers matching response frames.
 */
export class Multiplexer {
  private transport: ITransport
  private framer: Framer
  private pending = new Map<number, PendingRequest>()
  private nextStreamId = 0
  private timeout = 30000
  private sweepTimer: ReturnType<typeof globalThis.setInterval> | null = null
  private closed = false

  constructor(transport: ITransport) {
    this.transport = transport
    this.framer = new Framer()

    this.sweepTimer = globalThis.setInterval(() => this.sweepTimeouts(), 1000)
    this.sweepTimer.unref()

    this.transport.onData((chunk) => {
      const frames = this.framer.feed(chunk)
      for (const frame of frames) {
        this.handleFrame(frame)
      }
    })
  }

  private allocateStreamId(): number {
    let sid = this.nextStreamId
    while (this.pending.has(sid)) {
      sid = (sid + 1) & 0xffff
      if (sid === this.nextStreamId) {
        throw new Error('Max concurrent requests (65535) reached')
      }
    }
    this.nextStreamId = (sid + 1) & 0xffff
    return sid
  }

  async request(requestId: number, body: Uint8Array, data?: Uint8Array): Promise<Frame> {
    if (this.closed) {
      throw new Error('Multiplexer is closed')
    }

    const sid = this.allocateStreamId()

    const bodyBuf = Buffer.alloc(16)
    Buffer.from(body).copy(bodyBuf)

    const msg = new Message(24 + (data?.length ?? 0))
    msg.writeBytes(new Uint8Array([(sid >> 8) & 0xff, sid & 0xff]))
    msg.writeInt16BE(requestId)
    msg.writeBytes(bodyBuf)
    msg.writeInt32BE(data?.length ?? 0)
    if (data && data.length > 0) {
      msg.writeBytes(data)
    }

    return new Promise<Frame>((resolve, reject) => {
      this.pending.set(sid, {
        resolve,
        reject,
        expiresAt: Date.now() + this.timeout,
        requestId,
        body,
        data,
      })
      this.transport.send(msg.getBuffer()).catch(reject)
    })
  }

  private handleFrame(frame: Frame): void {
    const sid = (frame.streamId[0] << 8) | frame.streamId[1]

    if (frame.status === ResponseStatus.Wait) {
      const seconds = frame.body.readInt32BE(0)
      const pending = this.pending.get(sid)
      if (pending) {
        pending.expiresAt = Date.now() + seconds * 1000
        globalThis.setTimeout(() => this.retryRequest(sid), seconds * 1000)
      }
      return
    }

    if (frame.status === ResponseStatus.Waitresp) {
      const seconds = frame.body.readInt32BE(0)
      const pending = this.pending.get(sid)
      if (pending) {
        globalThis.setTimeout(() => this.retryRequest(sid), seconds * 1000)
      }
      return
    }

    const pending = this.pending.get(sid)
    if (!pending) return
    this.pending.delete(sid)
    pending.resolve(frame)
  }

  private retryRequest(sid: number): void {
    const pending = this.pending.get(sid)
    if (!pending) return
    this.pending.delete(sid)
    this.request(pending.requestId, pending.body, pending.data)
      .then(pending.resolve)
      .catch(pending.reject)
  }

  private sweepTimeouts(): void {
    const now = Date.now()
    for (const [sid, req] of this.pending.entries()) {
      if (now > req.expiresAt) {
        this.pending.delete(sid)
        req.reject(new Error(`Request timeout: streamid=${sid}`))
      }
    }
  }

  setTimeout(ms: number): void {
    this.timeout = ms
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.sweepTimer) {
      globalThis.clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }

    for (const [, req] of this.pending.entries()) {
      req.reject(new Error('Multiplexer closed'))
    }
    this.pending.clear()
  }
}
