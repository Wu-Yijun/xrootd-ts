import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { File } from '../../src/api/file.ts'
import type { Session } from '../../src/session/handshake.ts'
import { parseRedirectResponse } from '../../src/protocol/message.ts'
import { ResponseStatus } from '../../src/protocol/constants.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

function createMockServer(handler: (socket: net.Socket, data: Buffer) => Buffer | null): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
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

          const response = handler(socket, message)
          if (response) {
            socket.write(buildResponseFrame(streamId, 0, response))
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

describe('E2E: redirect flow', () => {
  it('handles kXR_redirect from server A to server B', async () => {
    let serverBCalled = false

    const { server: serverA, port: portA } = await createMockServer((_socket, message) => {
      const requestId = message.readUInt16BE(2)

      if (requestId === 3006) {
        // kXR_protocol
        const body = Buffer.alloc(8)
        body.writeUInt32BE(0x520, 0)
        body.writeUInt32BE(0x09, 4)
        return body
      }

      if (requestId === 3007) {
        // kXR_login → redirect
        const redirBody = Buffer.alloc(4 + 10)
        redirBody.writeUInt32BE(portB, 0)
        redirBody.write('localhost', 4, 'utf-8')
        return null as any // will be handled specially
      }

      return null
    })

    // Server A returns redirect for login
    const serverARedir = net.createServer((socket) => {
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
            // kXR_protocol → ok
            const body = Buffer.alloc(8)
            body.writeUInt32BE(0x520, 0)
            body.writeUInt32BE(0x09, 4)
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3007) {
            // kXR_login → redirect to server B
            const redirBody = Buffer.alloc(4 + 10)
            redirBody.writeUInt32BE(portB, 0)
            redirBody.write('localhost', 4, 'utf-8')
            socket.write(buildResponseFrame(streamId, 4004, redirBody))
          }
        }
      })
    })

    const { server: serverB, port: portB } = await createMockServer((_socket, message) => {
      const requestId = message.readUInt16BE(2)

      if (requestId === 3006) {
        // kXR_protocol
        const body = Buffer.alloc(8)
        body.writeUInt32BE(0x520, 0)
        body.writeUInt32BE(0x09, 4)
        return body
      }

      if (requestId === 3007) {
        // kXR_login
        serverBCalled = true
        const body = Buffer.alloc(16)
        for (let i = 0; i < 16; i++) body[i] = i + 1
        return body
      }

      if (requestId === 3010) {
        // kXR_open
        return Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])
      }

      if (requestId === 3013) {
        // kXR_read
        return Buffer.from('Redirected data')
      }

      if (requestId === 3003) {
        // kXR_close
        return Buffer.alloc(0)
      }

      return null
    })

    // Wait for server A to be ready with portB
    await new Promise(r => setTimeout(r, 10))

    try {
      // Step 1: Connect to server A
      const transport1 = new Transport()
      await transport1.connect('127.0.0.1', portA)
      const mux1 = new Multiplexer(transport1)

      // Step 2: Protocol handshake
      const protoFrame = await mux1.request(3006, new Uint8Array(16))
      assert.equal(protoFrame.status, 0)

      // Step 3: Login → expect redirect
      const loginBody = new Uint8Array(16)
      const loginFrame = await mux1.request(3007, loginBody)
      assert.equal(loginFrame.status, 4004, 'Expected kXR_redirect status')

      // Step 4: Parse redirect response
      const redir = parseRedirectResponse(loginFrame.body)
      assert.equal(redir.port, portB)

      mux1.close()
      await transport1.close()

      // Step 5: Connect to server B
      const transport2 = new Transport()
      await transport2.connect('127.0.0.1', redir.port)
      const mux2 = new Multiplexer(transport2)

      // Step 6: Re-do handshake on server B
      const protoFrame2 = await mux2.request(3006, new Uint8Array(16))
      assert.equal(protoFrame2.status, 0)

      const loginFrame2 = await mux2.request(3007, new Uint8Array(16))
      assert.equal(loginFrame2.status, 0)

      const session: Session = {
        sessid: new Uint8Array(loginFrame2.body.subarray(0, 16)),
        protocolVersion: 0x520,
      }

      // Step 7: Open + read on server B
      const file = new File(mux2, session)
      await file.open('/data/test.txt', { flags: 0x0010 })
      assert.equal(file.isOpen, true)

      const data = await file.read(0, 100)
      const text = new TextDecoder().decode(data)
      assert.equal(text, 'Redirected data')

      await file.close()
      assert.equal(serverBCalled, true)

      mux2.close()
      await transport2.close()
    } finally {
      serverARedir.close()
      serverA.close()
      serverB.close()
    }
  })
})
