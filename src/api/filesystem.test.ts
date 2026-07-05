import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { FileSystem } from './filesystem.ts'
import { Multiplexer } from '../transport/multiplexer.ts'
import type { ITransport } from '../transport/interface.ts'
import type { Frame } from '../transport/framer.ts'
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
}

describe('FileSystem', () => {
  let transport: MockTransport
  let mux: Multiplexer
  let fs: FileSystem

  beforeEach(() => {
    transport = new MockTransport()
    mux = new Multiplexer(transport)
    fs = new FileSystem(mux)
  })

  afterEach(() => {
    mux.close()
  })

  describe('stat', () => {
    it('returns stat info for existing file', async () => {
      const statPromise = fs.stat('/test/file.txt')
      await sleep(1)

      // Simulate stat response: "12345 1024 1700000000 0"
      const statBody = Buffer.from('12345 1024 1700000000 0')
      transport.simulateResponse(0, statBody)

      const info = await statPromise
      assert.equal(info.id, 12345)
      assert.equal(info.size, 1024)
      assert.equal(info.mtime, 1700000000)
      assert.equal(info.flags, 0)
      assert.equal(info.isDirectory, false)
    })

    it('parses directory flag correctly', async () => {
      const statPromise = fs.stat('/test/dir')
      await sleep(1)

      // flags 0x1000 = isDirectory
      const statBody = Buffer.from('12345 0 1700000000 4096')
      transport.simulateResponse(0, statBody)

      const info = await statPromise
      assert.equal(info.isDirectory, true)
    })

    it('throws XRootDError for not found', async () => {
      const statPromise = fs.stat('/nonexistent')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3011, 0) // NotFound
      errBody.write('File not found', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(statPromise, (err: any) => {
        assert.equal(err.code, 3011)
        return true
      })
    })
  })

  describe('readdir', () => {
    it('returns directory listing', async () => {
      const readdirPromise = fs.readdir('/test')
      await sleep(1)

      // Simulate dirlist response with NUL-separated entries
      const entries = 'file1.txt' + String.fromCharCode(0) + '100:0:1700000000\n' +
                       'file2.txt' + String.fromCharCode(0) + '200:0:1700000001\n'
      const dirlistBody = Buffer.from(entries)
      transport.simulateResponse(0, dirlistBody)

      const result = await readdirPromise
      assert.equal(result.name, '/test')
      assert.equal(result.entries.length, 2)
      assert.equal(result.entries[0].name, 'file1.txt')
      assert.equal(result.entries[0].size, 100)
      assert.equal(result.entries[1].name, 'file2.txt')
      assert.equal(result.entries[1].size, 200)
    })

    it('throws XRootDError for permission denied', async () => {
      const readdirPromise = fs.readdir('/restricted')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3010, 0) // NotAuthorized
      errBody.write('Permission denied', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(readdirPromise, (err: any) => {
        assert.equal(err.code, 3010)
        return true
      })
    })
  })

  describe('mkdir', () => {
    it('creates directory successfully', async () => {
      const mkdirPromise = fs.mkdir('/new/dir')
      await sleep(1)
      transport.simulateResponse(0, Buffer.alloc(0))
      await mkdirPromise
    })

    it('throws XRootDError for existing directory', async () => {
      const mkdirPromise = fs.mkdir('/existing')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3018, 0) // ItExists
      errBody.write('Directory exists', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(mkdirPromise, (err: any) => {
        assert.equal(err.code, 3018)
        return true
      })
    })
  })

  describe('rmdir', () => {
    it('removes directory successfully', async () => {
      const rmdirPromise = fs.rmdir('/old/dir')
      await sleep(1)
      transport.simulateResponse(0, Buffer.alloc(0))
      await rmdirPromise
    })

    it('throws XRootDError for non-empty directory', async () => {
      const rmdirPromise = fs.rmdir('/nonempty')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3005, 0) // FSError
      errBody.write('Directory not empty', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(rmdirPromise, (err: any) => {
        assert.equal(err.code, 3005)
        return true
      })
    })
  })

  describe('rm', () => {
    it('removes file successfully', async () => {
      const rmPromise = fs.rm('/file/to/delete')
      await sleep(1)
      transport.simulateResponse(0, Buffer.alloc(0))
      await rmPromise
    })

    it('throws XRootDError for not found', async () => {
      const rmPromise = fs.rm('/nonexistent')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3011, 0) // NotFound
      errBody.write('File not found', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(rmPromise, (err: any) => {
        assert.equal(err.code, 3011)
        return true
      })
    })
  })

  describe('mv', () => {
    it('moves file successfully', async () => {
      const mvPromise = fs.mv('/old/path', '/new/path')
      await sleep(1)
      transport.simulateResponse(0, Buffer.alloc(0))
      await mvPromise
    })

    it('throws XRootDError for not found source', async () => {
      const mvPromise = fs.mv('/nonexistent', '/new/path')
      await sleep(1)

      const errBody = Buffer.alloc(4 + 20)
      errBody.writeInt32BE(3011, 0) // NotFound
      errBody.write('Source not found', 4, 'utf8')
      transport.simulateResponse(4003, errBody)

      await assert.rejects(mvPromise, (err: any) => {
        assert.equal(err.code, 3011)
        return true
      })
    })
  })
})
