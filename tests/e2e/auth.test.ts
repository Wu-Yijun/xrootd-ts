import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { handshake } from '../../src/session/handshake.ts'
import { XRootDUrl } from '../../src/url/url.ts'
import { registerAuthProtocol } from '../../src/session/auth.ts'
import { HostAuth } from '../../src/security/host.ts'
import { SSSAuth } from '../../src/security/sss.ts'
import type { Session } from '../../src/session/handshake.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

function parseRequest(message: Buffer): { requestId: number; body: Buffer } {
  const requestId = message.readUInt16BE(2)
  const dlen = message.readUInt32BE(20)
  const body = Buffer.from(message.subarray(24, 24 + dlen))
  return { requestId, body }
}

function createAuthServer(
  secReqs: string,
  authHandler?: (credType: number, credData: Buffer) => { ok: boolean; msg?: string },
): Promise<{ server: net.Server; port: number }> {
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
          const { body: reqBody } = parseRequest(message)

          if (requestId === 3006) {
            // kXR_protocol - include secReqs
            const protoText = `v0x520 0x09 ${secReqs}`
            const body = Buffer.alloc(8 + protoText.length + 1)
            body.writeUInt32BE(0x520, 0)
            body.writeUInt32BE(0x09, 4)
            Buffer.from(protoText + '\0').copy(body, 8)
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3007) {
            // kXR_login
            const body = Buffer.alloc(16)
            for (let i = 0; i < 16; i++) body[i] = i + 1
            socket.write(buildResponseFrame(streamId, 0, body))
          } else if (requestId === 3000) {
            // kXR_auth
            const credType = reqBody.readUInt32BE(12)
            const credData = Buffer.from(reqBody.subarray(16))

            if (authHandler) {
              const result = authHandler(credType, credData)
              if (result.ok) {
                socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
              } else {
                const errBody = Buffer.alloc(4 + (result.msg?.length ?? 10) + 1)
                errBody.writeUInt32BE(3030, 0)
                Buffer.from(result.msg ?? 'Auth failed\0').copy(errBody, 4)
                socket.write(buildResponseFrame(streamId, 4003, errBody))
              }
            } else {
              socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
            }
          } else {
            const body = Buffer.alloc(4)
            body.writeUInt32BE(3006, 0)
            socket.write(buildResponseFrame(streamId, 4003, body))
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

describe('E2E: host authentication', () => {
  it('authenticates with host protocol', async () => {
    const { server, port } = await createAuthServer('host', (credType, credData) => {
      // host auth sends hostname as credentials
      assert.equal(credType, 0, 'credType should be 0 (host)')
      assert.ok(credData.length > 0, 'credData should not be empty')
      return { ok: true }
    })

    try {
      registerAuthProtocol('host', () => new HostAuth())

      const transport = new Transport()
      await transport.connect('127.0.0.1', port)
      const mux = new Multiplexer(transport)
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`)

      const session = await handshake(mux, url)

      assert.ok(session, 'session should be defined')
      assert.ok(session.sessid, 'sessid should be defined')
      assert.equal(session.sessid.length, 16)

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })

  it('auth failure throws error', async () => {
    const { server, port } = await createAuthServer('host', () => {
      return { ok: false, msg: 'Host not trusted' }
    })

    try {
      registerAuthProtocol('host', () => new HostAuth())

      const transport = new Transport()
      await transport.connect('127.0.0.1', port)
      const mux = new Multiplexer(transport)
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`)

      try {
        await handshake(mux, url)
        assert.fail('Expected auth error')
      } catch (err) {
        assert.ok(err instanceof Error)
        assert.match(err.message, /auth/i)
      }

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })
})

describe('E2E: unsupported auth protocol', () => {
  it('throws when no supported auth protocol', async () => {
    const { server, port } = await createAuthServer('krb5')

    try {
      const transport = new Transport()
      await transport.connect('127.0.0.1', port)
      const mux = new Multiplexer(transport)
      const url = new XRootDUrl(`root://127.0.0.1:${port}/`)

      try {
        await handshake(mux, url)
        assert.fail('Expected auth error')
      } catch (err) {
        assert.ok(err instanceof Error)
      }

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })
})
