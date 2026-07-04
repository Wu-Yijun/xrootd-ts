import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { File } from '../../src/api/file.ts'
import { XRootDError } from '../../src/api/errors.ts'
import type { Session } from '../../src/session/handshake.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

describe('E2E: error handling', () => {
  it('kXR_error throws XRootDError', async () => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0)

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= 24) {
          const requestId = buffer.readUInt16BE(2)
          const dlen = buffer.readUInt32BE(20)
          const totalLen = 24 + dlen

          if (buffer.length < totalLen) break

          const message = buffer.subarray(0, totalLen)
          buffer = buffer.subarray(totalLen)

          const streamId = (message[0] << 8) | message[1]

          if (requestId === 3006) {
            // kXR_protocol
            const body = Buffer.alloc(8)
            body.writeUInt32BE(0x520, 0)
            body.writeUInt32BE(0x09, 4)
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3007) {
            // kXR_login
            const body = Buffer.alloc(16)
            for (let i = 0; i < 16; i++) body[i] = i + 1
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3010) {
            // kXR_open → error (file not found)
            const errBody = Buffer.alloc(4 + 12)
            errBody.writeUInt32BE(3011, 0) // NotFound
            errBody.write('No such file', 4, 'utf-8')
            socket.write(buildResponseFrame(streamId, 4003, errBody))
          }
        }
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as net.AddressInfo

    try {
      const transport = new Transport()
      await transport.connect('127.0.0.1', addr.port)
      const mux = new Multiplexer(transport)

      // Protocol + login
      const protoFrame = await mux.request(3006, new Uint8Array(16))
      assert.equal(protoFrame.status, 0)

      const loginFrame = await mux.request(3007, new Uint8Array(16))
      assert.equal(loginFrame.status, 0)

      const session: Session = {
        sessid: new Uint8Array(loginFrame.body.subarray(0, 16)),
        protocolVersion: 0x520,
      }

      const file = new File(mux, session)

      // Open should throw XRootDError with NotFound
      try {
        await file.open('/nonexistent/file.txt', { flags: 0x0010 })
        assert.fail('Expected XRootDError')
      } catch (err) {
        assert.ok(err instanceof XRootDError)
        assert.equal(err.code, 3011) // NotFound
        assert.match(err.message, /not found/i)
      }

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })

  it('connection disconnect rejects pending request', async () => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0)

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= 24) {
          const requestId = buffer.readUInt16BE(2)
          const dlen = buffer.readUInt32BE(20)
          const totalLen = 24 + dlen

          if (buffer.length < totalLen) break

          const message = buffer.subarray(0, totalLen)
          buffer = buffer.subarray(totalLen)

          const streamId = (message[0] << 8) | message[1]

          if (requestId === 3006) {
            // kXR_protocol
            const body = Buffer.alloc(8)
            body.writeUInt32BE(0x520, 0)
            body.writeUInt32BE(0x09, 4)
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3007) {
            // kXR_login
            const body = Buffer.alloc(16)
            for (let i = 0; i < 16; i++) body[i] = i + 1
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3013) {
            // kXR_read → destroy connection mid-response
            socket.destroy()
          }
        }
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as net.AddressInfo

    try {
      const transport = new Transport()
      await transport.connect('127.0.0.1', addr.port)
      const mux = new Multiplexer(transport)

      // Protocol + login
      const protoFrame = await mux.request(3006, new Uint8Array(16))
      assert.equal(protoFrame.status, 0)

      const loginFrame = await mux.request(3007, new Uint8Array(16))
      assert.equal(loginFrame.status, 0)

      const session: Session = {
        sessid: new Uint8Array(loginFrame.body.subarray(0, 16)),
        protocolVersion: 0x520,
      }

      const file = new File(mux, session)
      await file.open('/data/test.txt', { flags: 0x0010 })

      // Read should fail due to connection destruction
      try {
        await file.read(0, 100)
        assert.fail('Expected error')
      } catch (err) {
        assert.ok(err instanceof Error)
      }

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })

  it('timeout rejects pending request', async () => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0)

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= 24) {
          const requestId = buffer.readUInt16BE(2)
          const dlen = buffer.readUInt32BE(20)
          const totalLen = 24 + dlen

          if (buffer.length < totalLen) break

          const message = buffer.subarray(0, totalLen)
          buffer = buffer.subarray(totalLen)

          const streamId = (message[0] << 8) | message[1]

          if (requestId === 3006) {
            // kXR_protocol
            const body = Buffer.alloc(8)
            body.writeUInt32BE(0x520, 0)
            body.writeUInt32BE(0x09, 4)
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3007) {
            // kXR_login
            const body = Buffer.alloc(16)
            for (let i = 0; i < 16; i++) body[i] = i + 1
            socket.write(buildResponseFrame(streamId, 0, body))
          }
          // Don't respond to other requests (simulates server not responding)
        }
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as net.AddressInfo

    try {
      const transport = new Transport()
      await transport.connect('127.0.0.1', addr.port)
      const mux = new Multiplexer(transport)
      mux.setTimeout(100) // Very short timeout

      // Protocol + login
      const protoFrame = await mux.request(3006, new Uint8Array(16))
      assert.equal(protoFrame.status, 0)

      const loginFrame = await mux.request(3007, new Uint8Array(16))
      assert.equal(loginFrame.status, 0)

      // This request will never get a response → timeout
      try {
        await mux.request(3013, new Uint8Array(16)) // kXR_read
        assert.fail('Expected timeout error')
      } catch (err) {
        assert.ok(err instanceof Error)
        assert.match(err.message, /timeout/)
      }

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })
})
