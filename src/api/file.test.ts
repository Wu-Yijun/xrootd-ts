import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { File } from './file.ts'
import { Multiplexer } from '../transport/multiplexer.ts'
import type { ITransport } from '../transport/interface.ts'
import type { Session } from '../session/handshake.ts'
import { XRootDError } from './errors.ts'

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

class MockTransportForFile implements ITransport {
  private dataCallback: ((chunk: Buffer) => void) | null = null
  sentData: Buffer[] = []
  private responseQueue: ((streamId: number) => Buffer)[] = []

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  destroy(): void {}

  async send(data: Buffer): Promise<void> {
    this.sentData.push(Buffer.from(data))
    // Auto-respond if response is queued
    if (this.responseQueue.length > 0) {
      const sid = extractStreamId(data)
      const builder = this.responseQueue.shift()!
      const resp = builder(sid)
      setTimeout(() => this.dataCallback?.(resp), 0)
    }
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.dataCallback = callback
  }

  enqueueResponse(status: number, body: Buffer): void {
    this.responseQueue.push((sid) => buildResponseFrame(sid, status, body))
  }

  enqueueResponseBuilder(builder: (streamId: number) => Buffer): void {
    this.responseQueue.push(builder)
  }
}

const testSession: Session = {
  sessid: new Uint8Array(16),
  protocolVersion: 0x520,
}

describe('File', () => {
  it('open() sends correct request and stores fhandle', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    const fhandle = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
    transport.enqueueResponse(0, fhandle)

    await file.open('/data/test.txt', { flags: 0x0010 })
    assert.equal(file.isOpen, true)

    // Verify request was sent
    assert.ok(transport.sentData.length > 0)

    await file.close()
    mux.close()
  })

  it('read() sends correct request with fhandle + offset + size', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    // Open first
    const fhandle = Buffer.from([0x01, 0x02, 0x03, 0x04])
    transport.enqueueResponse(0, fhandle)
    await file.open('/test', { flags: 0x0010 })

    // Read
    const fileData = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    transport.enqueueResponse(0, fileData)

    const data = await file.read(1024, 4096)
    assert.deepEqual([...data], [0xde, 0xad, 0xbe, 0xef])

    // Verify read request
    const readReq = transport.sentData[transport.sentData.length - 1]
    assert.equal(readReq.readUInt16BE(2), 3013) // kXR_read

    await file.close()
    mux.close()
  })

  it('write() sends correct request', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    // Open
    const fhandle = Buffer.from([0x11, 0x22, 0x33, 0x44])
    transport.enqueueResponse(0, fhandle)
    await file.open('/test', { flags: 0x0020 })

    // Write
    const writeData = new Uint8Array([1, 2, 3, 4, 5])
    transport.enqueueResponse(0, Buffer.alloc(0))

    const written = await file.write(0, writeData)
    assert.equal(written, 0) // dlen=0 in ok response

    // Verify write request
    const writeReq = transport.sentData[transport.sentData.length - 1]
    assert.equal(writeReq.readUInt16BE(2), 3019) // kXR_write

    await file.close()
    mux.close()
  })

  it('close() sends close request and clears state', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    // Open
    const fhandle = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
    transport.enqueueResponse(0, fhandle)
    await file.open('/test', { flags: 0x0010 })
    assert.equal(file.isOpen, true)

    // Close
    transport.enqueueResponse(0, Buffer.alloc(0))
    await file.close()

    assert.equal(file.isOpen, false)

    mux.close()
  })

  it('operations on closed file throw XRootDError', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    await assert.rejects(
      () => file.read(0, 100),
      (err: any) => err instanceof XRootDError && err.code === 3004,
    )

    await assert.rejects(
      () => file.write(0, new Uint8Array(1)),
      (err: any) => err instanceof XRootDError && err.code === 3004,
    )

    mux.close()
  })

  it('open on already-open file throws', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    const fhandle = Buffer.from([0x01, 0x02, 0x03, 0x04])
    transport.enqueueResponse(0, fhandle)
    await file.open('/test', { flags: 0x0010 })

    await assert.rejects(
      () => file.open('/other', { flags: 0x0010 }),
      (err: any) => err instanceof XRootDError && err.code === 3004,
    )

    transport.enqueueResponse(0, Buffer.alloc(0))
    await file.close()
    mux.close()
  })

  it('open error throws XRootDError', async () => {
    const transport = new MockTransportForFile()
    const mux = new Multiplexer(transport)
    const file = new File(mux, testSession)

    const errMsg = 'not found'
    const errBody = Buffer.alloc(4 + errMsg.length + 1)
    errBody.writeUInt32BE(3011, 0)
    Buffer.from(errMsg, 'utf8').copy(errBody, 4)
    errBody[4 + errMsg.length] = 0
    transport.enqueueResponse(4003, errBody)

    await assert.rejects(
      () => file.open('/nonexistent', { flags: 0x0010 }),
      (err: any) => err instanceof XRootDError && err.code === 3011,
    )

    mux.close()
  })
})
