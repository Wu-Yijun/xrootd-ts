import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { FileSystem } from '../../src/api/filesystem.ts'
import type { Session } from '../../src/session/handshake.ts'

function buildResponseFrame(streamId: number, status: number, body: Buffer): Buffer {
  const hdr = Buffer.alloc(8)
  hdr.writeUInt16BE(streamId, 0)
  hdr.writeUInt16BE(status, 2)
  hdr.writeUInt32BE(body.length, 4)
  return Buffer.concat([hdr, body])
}

function parseRequest(message: Buffer): { requestId: number; body: Buffer; dlen: number } {
  const requestId = message.readUInt16BE(2)
  const dlen = message.readUInt32BE(20)
  const body = Buffer.from(message.subarray(24, 24 + dlen))
  return { requestId, body, dlen }
}

function createFileSystemServer(): Promise<{ server: net.Server; port: number }> {
  const dirs = new Map<string, Map<string, { isDir: boolean }>>()
  dirs.set('/', new Map([['data', { isDir: true }]]))
  dirs.set('/data', new Map([['test', { isDir: true }]]))
  dirs.set('/data/test', new Map([['file.txt', { isDir: false }]]))

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
          } else if (requestId === 3012) {
            // kXR_stat
            const path = reqBody.toString('utf8').replace(/\0+$/, '')
            const parent = path.substring(0, path.lastIndexOf('/')) || '/'
            const name = path.substring(path.lastIndexOf('/') + 1)
            const parentDir = dirs.get(parent)

            if (parentDir && parentDir.has(name)) {
              const entry = parentDir.get(name)!
              const flags = entry.isDir ? 0x4000 : 0
              const statBody = Buffer.from(`0 0 0 ${flags}`)
              socket.write(buildResponseFrame(streamId, 0, statBody))
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
          } else if (requestId === 3004) {
            // kXR_dirlist
            const path = reqBody.toString('utf8').replace(/\0+$/, '')
            const dir = dirs.get(path)
            if (dir) {
              const entries: Buffer[] = []
              for (const [name, info] of dir) {
                const flags = info.isDir ? 0x4000 : 0
                const entry = Buffer.from(`${name}\0000:0:${flags}\n`)
                entries.push(entry)
              }
              const body = entries.length > 0
                ? Buffer.concat(entries)
                : Buffer.alloc(0)
              socket.write(buildResponseFrame(streamId, 0, body))
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
          } else if (requestId === 3008) {
            // kXR_mkdir
            const path = reqBody.toString('utf8').replace(/\0+$/, '')
            const parent = path.substring(0, path.lastIndexOf('/')) || '/'
            const name = path.substring(path.lastIndexOf('/') + 1)
            const parentDir = dirs.get(parent)

            if (parentDir) {
              if (parentDir.has(name)) {
                const errBody = Buffer.alloc(4 + 9)
                errBody.writeUInt32BE(3014, 0)
                Buffer.from('It exists\0').copy(errBody, 4)
                socket.write(buildResponseFrame(streamId, 4003, errBody))
              } else {
                parentDir.set(name, { isDir: true })
                dirs.set(path, new Map())
                socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
              }
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
          } else if (requestId === 3015) {
            // kXR_rmdir
            const path = reqBody.toString('utf8').replace(/\0+$/, '')
            const parent = path.substring(0, path.lastIndexOf('/')) || '/'
            const name = path.substring(path.lastIndexOf('/') + 1)
            const parentDir = dirs.get(parent)
            const dir = dirs.get(path)

            if (parentDir && parentDir.has(name)) {
              if (dir && dir.size > 0) {
                const errBody = Buffer.alloc(4 + 14)
                errBody.writeUInt32BE(3015, 0)
                Buffer.from('Dir not empty\0').copy(errBody, 4)
                socket.write(buildResponseFrame(streamId, 4003, errBody))
              } else {
                parentDir.delete(name)
                dirs.delete(path)
                socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
              }
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
          } else if (requestId === 3014) {
            // kXR_rm
            const path = reqBody.toString('utf8').replace(/\0+$/, '')
            const parent = path.substring(0, path.lastIndexOf('/')) || '/'
            const name = path.substring(path.lastIndexOf('/') + 1)
            const parentDir = dirs.get(parent)

            if (parentDir && parentDir.has(name)) {
              const entry = parentDir.get(name)!
              if (entry.isDir) {
                const errBody = Buffer.alloc(4 + 9)
                errBody.writeUInt32BE(3014, 0)
                Buffer.from('Is a dir\0').copy(errBody, 4)
                socket.write(buildResponseFrame(streamId, 4003, errBody))
              } else {
                parentDir.delete(name)
                socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
              }
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
          } else if (requestId === 3009) {
            // kXR_mv
            const arg1len = reqBody.readUInt16BE(0)
            const source = reqBody.subarray(2, 2 + arg1len).toString('utf8').replace(/\0+$/, '')
            const target = reqBody.subarray(2 + arg1len).toString('utf8').replace(/\0+$/, '')

            const srcParent = source.substring(0, source.lastIndexOf('/')) || '/'
            const srcName = source.substring(source.lastIndexOf('/') + 1)
            const tgtParent = target.substring(0, target.lastIndexOf('/')) || '/'
            const tgtName = target.substring(target.lastIndexOf('/') + 1)

            const srcDir = dirs.get(srcParent)
            const tgtDir = dirs.get(tgtParent)

            if (srcDir && srcDir.has(srcName) && tgtDir) {
              const entry = srcDir.get(srcName)!
              srcDir.delete(srcName)
              tgtDir.set(tgtName, entry)
              socket.write(buildResponseFrame(streamId, 0, Buffer.alloc(0)))
            } else {
              const errBody = Buffer.alloc(4 + 13)
              errBody.writeUInt32BE(3011, 0)
              Buffer.from('No such file\0').copy(errBody, 4)
              socket.write(buildResponseFrame(streamId, 4003, errBody))
            }
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

async function setupSession(port: number): Promise<{
  transport: Transport
  mux: Multiplexer
  session: Session
  fs: FileSystem
}> {
  const transport = new Transport()
  await transport.connect('127.0.0.1', port)
  const mux = new Multiplexer(transport)

  const protoFrame = await mux.request(3006, new Uint8Array(16))
  assert.equal(protoFrame.status, 0)

  const loginFrame = await mux.request(3007, new Uint8Array(16))
  assert.equal(loginFrame.status, 0)

  const session: Session = {
    sessid: new Uint8Array(loginFrame.body.subarray(0, 16)),
    protocolVersion: 0x520,
  }

  const fs = new FileSystem(mux)
  return { transport, mux, session, fs }
}

describe('E2E: FileSystem lifecycle', () => {
  it('mkdir -> readdir -> mv -> rm -> rmdir', async () => {
    const { server, port } = await createFileSystemServer()

    try {
      const { mux, transport, fs } = await setupSession(port)

      // mkdir
      await fs.mkdir('/data/test/newdir')
      assert.ok(true, 'mkdir should succeed')

      // readdir - should contain newdir
      const list1 = await fs.readdir('/data/test')
      const names1 = list1.entries.map(e => e.name)
      assert.ok(names1.includes('newdir'), `should contain newdir, got: ${names1.join(', ')}`)

      // mv
      await fs.mv('/data/test/newdir', '/data/test/renameddir')
      assert.ok(true, 'mv should succeed')

      // readdir - should contain renameddir, not newdir
      const list2 = await fs.readdir('/data/test')
      const names2 = list2.entries.map(e => e.name)
      assert.ok(names2.includes('renameddir'), `should contain renameddir, got: ${names2.join(', ')}`)
      assert.ok(!names2.includes('newdir'), 'should not contain newdir')

      // rmdir
      await fs.rmdir('/data/test/renameddir')
      assert.ok(true, 'rmdir should succeed')

      // readdir - should not contain renameddir
      const list3 = await fs.readdir('/data/test')
      const names3 = list3.entries.map(e => e.name)
      assert.ok(!names3.includes('renameddir'), 'should not contain renameddir after rmdir')

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })

  it('mkdir on existing directory throws', async () => {
    const { server, port } = await createFileSystemServer()

    try {
      const { mux, transport, fs } = await setupSession(port)

      try {
        await fs.mkdir('/data/test')
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

  it('rmdir on non-empty directory throws', async () => {
    const { server, port } = await createFileSystemServer()

    try {
      const { mux, transport, fs } = await setupSession(port)

      try {
        await fs.rmdir('/data/test')
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

  it('rm on non-existent file throws', async () => {
    const { server, port } = await createFileSystemServer()

    try {
      const { mux, transport, fs } = await setupSession(port)

      try {
        await fs.rm('/data/test/nonexistent.txt')
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

  it('rm file succeeds', async () => {
    const { server, port } = await createFileSystemServer()

    try {
      const { mux, transport, fs } = await setupSession(port)

      // Create a file to remove
      await fs.mkdir('/data/test/dirwithfile')
      await fs.readdir('/data/test')

      // Remove the file from the test directory (file.txt exists in /data/test)
      await fs.rm('/data/test/file.txt')
      assert.ok(true, 'rm should succeed')

      const list = await fs.readdir('/data/test')
      const names = list.entries.map(e => e.name)
      assert.ok(!names.includes('file.txt'), 'should not contain file.txt after rm')

      mux.close()
      await transport.close()
    } finally {
      server.close()
    }
  })
})
