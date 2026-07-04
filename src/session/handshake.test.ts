import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { handshake } from './handshake.ts'
import { Multiplexer } from '../transport/multiplexer.ts'
import { XRootDUrl } from '../url/url.ts'

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

class MockTransportForHandshake {
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

  emit(data: Buffer): void {
    this.dataCallback?.(data)
  }
}

describe('handshake', () => {
  it('returns Session with correct sessid and protocolVersion', async () => {
    const transport = new MockTransportForHandshake()
    const mux = new Multiplexer(transport as any)
    const url = new XRootDUrl('root://host.cern.ch/data')

    // handshake() will call transport.send(handshakeBuf)
    // then readExact(transport, 20) which registers its own onData handler
    // then waitForFrame(mux) which registers another onData handler
    // then transport.send(loginBuf)
    // then waitForFrame(mux) again

    const sessionPromise = handshake(mux, url, { username: 'test', pid: 1234 })

    // Let the handshake function start and register handlers
    await new Promise(r => setTimeout(r, 10))

    // Step 1: handshake was sent, send back ServerResponseHeader(8B) + ServerInitHandShake(12B) = 20 bytes
    const serverInit = Buffer.alloc(20)
    serverInit.writeUInt32BE(0, 0)   // msglen
    serverInit.writeUInt32BE(0x520, 4) // protover
    serverInit.writeUInt32BE(1, 8)  // msgval (DataServer)
    transport.emit(serverInit)

    // Wait for readExact to process and waitForFrame to register its handler
    await new Promise(r => setTimeout(r, 10))

    // Step 2: send kXR_ok + protocol response (using streamId=0 since the handshake uses streamId=0)
    const protoBody = Buffer.alloc(8)
    protoBody.writeUInt32BE(0x520, 0) // pval
    protoBody.writeUInt32BE(0x09, 4)  // flags
    transport.emit(buildResponseFrame(0, 0, protoBody))

    // Wait for waitForFrame to resolve, login to be sent, and next waitForFrame to register
    await new Promise(r => setTimeout(r, 10))

    // Step 3: send kXR_ok + sessid[16]
    const loginBody = Buffer.alloc(16)
    for (let i = 0; i < 16; i++) loginBody[i] = i + 1
    transport.emit(buildResponseFrame(0, 0, loginBody))

    const session = await sessionPromise

    assert.equal(session.protocolVersion, 0x520)
    assert.deepEqual([...session.sessid], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

    mux.close()
  })

  it('sends correct handshake + protocol in first send', async () => {
    const transport = new MockTransportForHandshake()
    const mux = new Multiplexer(transport as any)
    const url = new XRootDUrl('root://host.cern.ch/data')

    const sessionPromise = handshake(mux, url)

    await new Promise(r => setTimeout(r, 10))

    // Send all responses to unblock handshake
    const serverInit = Buffer.alloc(20)
    serverInit.writeUInt32BE(0, 0)
    serverInit.writeUInt32BE(0x520, 4)
    serverInit.writeUInt32BE(1, 8)
    transport.emit(serverInit)

    await new Promise(r => setTimeout(r, 10))

    transport.emit(buildResponseFrame(0, 0, (() => {
      const b = Buffer.alloc(8)
      b.writeUInt32BE(0x520, 0)
      b.writeUInt32BE(0x09, 4)
      return b
    })()))

    await new Promise(r => setTimeout(r, 10))

    transport.emit(buildResponseFrame(0, 0, Buffer.alloc(16)))

    await sessionPromise

    // First send should be 44 bytes (20 handshake + 24 protocol)
    const firstSend = transport.sentData[0]
    assert.equal(firstSend.length, 44)

    // Verify handshake fields
    assert.equal(firstSend.readInt32BE(0), 0)    // first
    assert.equal(firstSend.readInt32BE(4), 0)    // second
    assert.equal(firstSend.readInt32BE(8), 0)    // third
    assert.equal(firstSend.readInt32BE(12), 4)   // fourth
    assert.equal(firstSend.readInt32BE(16), 2012) // fifth

    // Verify protocol request
    assert.equal(firstSend.readUInt16BE(22), 3006) // kXR_protocol
    assert.equal(firstSend.readUInt32BE(24), 0x520) // clientpv

    mux.close()
  })

  it('sends login request as second send', async () => {
    const transport = new MockTransportForHandshake()
    const mux = new Multiplexer(transport as any)
    const url = new XRootDUrl('root://host.cern.ch/data')

    const sessionPromise = handshake(mux, url, { username: 'alice', pid: 42 })

    await new Promise(r => setTimeout(r, 10))

    const serverInit = Buffer.alloc(20)
    serverInit.writeUInt32BE(0, 0)
    serverInit.writeUInt32BE(0x520, 4)
    serverInit.writeUInt32BE(1, 8)
    transport.emit(serverInit)

    await new Promise(r => setTimeout(r, 10))

    transport.emit(buildResponseFrame(0, 0, (() => {
      const b = Buffer.alloc(8)
      b.writeUInt32BE(0x520, 0)
      b.writeUInt32BE(0x09, 4)
      return b
    })()))

    await new Promise(r => setTimeout(r, 10))

    transport.emit(buildResponseFrame(0, 0, Buffer.alloc(16)))

    await sessionPromise

    // Second send should be login request
    const loginSend = transport.sentData[1]
    assert.equal(loginSend.readUInt16BE(2), 3007) // kXR_login
    assert.equal(loginSend.readUInt32BE(4), 42)   // pid
    const username = loginSend.toString('utf8', 8, 16).replace(/\0+$/, '')
    assert.equal(username, 'alice')

    mux.close()
  })
})
