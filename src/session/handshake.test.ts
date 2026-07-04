import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { handshake } from './handshake.ts'
import { Multiplexer } from '../transport/multiplexer.ts'
import { XRootDUrl } from '../url/url.ts'
import { Framer } from '../transport/framer.ts'

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
  private handlers: ((chunk: Buffer) => void)[] = []
  sentData: Buffer[] = []
  private step = 0

  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  destroy(): void {}

  async send(data: Buffer): Promise<void> {
    this.sentData.push(Buffer.from(data))
    this.step++
    this.handleStep()
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.handlers.push(callback)
    this.dataCallback = callback
  }

  private emit(data: Buffer): void {
    if (this.dataCallback) {
      this.dataCallback(data)
    }
  }

  private handleStep(): void {
    if (this.step === 1) {
      // Step 1: Client sends handshake + protocol
      // Server responds with: ServerResponseHeader(8B) + ServerInitHandShake(12B)
      const serverInit = Buffer.alloc(20)
      serverInit.writeUInt32BE(0, 0) // msglen
      serverInit.writeUInt32BE(0x520, 4) // protover
      serverInit.writeUInt32BE(1, 8) // msgval (DataServer)
      // padding
      this.emit(serverInit)

      // Then kXR_ok + protocol response
      setTimeout(() => {
        const sid = extractStreamId(this.sentData[0])
        const protoBody = Buffer.alloc(8)
        protoBody.writeUInt32BE(0x520, 0) // pval
        protoBody.writeUInt32BE(0x09, 4)  // flags
        this.emit(buildResponseFrame(sid, 0, protoBody))
      }, 1)
    } else if (this.step === 2) {
      // Step 2: Client sends login
      // Server responds with kXR_ok + sessid[16]
      setTimeout(() => {
        const sid = extractStreamId(this.sentData[1])
        const loginBody = Buffer.alloc(16)
        for (let i = 0; i < 16; i++) loginBody[i] = i + 1
        this.emit(buildResponseFrame(sid, 0, loginBody))
      }, 1)
    }
  }
}

describe('handshake', () => {
  it('returns Session with correct sessid and protocolVersion', async () => {
    const transport = new MockTransportForHandshake()
    const mux = new Multiplexer(transport as any)
    const url = new XRootDUrl('root://host.cern.ch/data')

    const session = await handshake(mux, url, { username: 'test', pid: 1234 })

    assert.equal(session.protocolVersion, 0x520)
    assert.deepEqual([...session.sessid], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

    mux.close()
  })

  it('sends correct handshake + protocol in first send', async () => {
    const transport = new MockTransportForHandshake()
    const mux = new Multiplexer(transport as any)
    const url = new XRootDUrl('root://host.cern.ch/data')

    await handshake(mux, url)

    // First send should be 44 bytes (20 handshake + 24 protocol)
    const firstSend = transport.sentData[0]
    assert.equal(firstSend.length, 44)

    // Verify handshake fields
    assert.equal(firstSend.readInt32BE(0), 0)   // first
    assert.equal(firstSend.readInt32BE(4), 0)   // second
    assert.equal(firstSend.readInt32BE(8), 0)   // third
    assert.equal(firstSend.readInt32BE(12), 4)  // fourth
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

    await handshake(mux, url, { username: 'alice', pid: 42 })

    // Second send should be login request
    const loginSend = transport.sentData[1]
    assert.equal(loginSend.readUInt16BE(2), 3007) // kXR_login
    assert.equal(loginSend.readUInt32BE(4), 42)   // pid
    const username = loginSend.toString('utf8', 8, 16).replace(/\0+$/, '')
    assert.equal(username, 'alice')

    mux.close()
  })
})
