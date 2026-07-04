import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { File } from '../../src/api/file.ts'
import type { Session } from '../../src/session/handshake.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

function createSimulatedServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0)

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])

        // Process all complete messages
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
            // kXR_open
            const body = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3013) {
            // kXR_read
            const data = Buffer.from('Hello, XRootD!')
            socket.write(buildResponseFrame(streamId, 0, data))
          } else if (requestId === 3003) {
            // kXR_close
            socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
          } else {
            const errBody = Buffer.alloc(4)
            errBody.writeUInt32BE(3006, 0)
            socket.write(buildResponseFrame(streamId, 4003, errBody))
          }
        }
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({ server, port: addr.port })
    })
  })
}

async function runE2ETest() {
  const { server, port } = await createSimulatedServer()

  try {
    const transport = new Transport()
    await transport.connect('127.0.0.1', port)
    const mux = new Multiplexer(transport)

    // Send protocol request
    const protoFrame = await mux.request(3006, new Uint8Array(16))
    assert.equal(protoFrame.status, 0)

    // Send login request
    const loginBody = new Uint8Array(16)
    const loginFrame = await mux.request(3007, loginBody)
    assert.equal(loginFrame.status, 0)

    const session: Session = {
      sessid: new Uint8Array(loginFrame.body.subarray(0, 16)),
      protocolVersion: 0x520,
    }

    const file = new File(mux, session)

    // Open
    await file.open('/data/test.txt', { flags: 0x0010 })
    assert.equal(file.isOpen, true)

    // Read
    const data = await file.read(0, 100)
    const text = new TextDecoder().decode(data)
    assert.equal(text, 'Hello, XRootD!')

    // Close
    await file.close()
    assert.equal(file.isOpen, false)

    mux.close()
    await transport.close()
  } finally {
    server.close()
  }
}

describe('E2E: read flow', () => {
  it('completes login → open → read → close', async () => {
    await runE2ETest()
  })
})
