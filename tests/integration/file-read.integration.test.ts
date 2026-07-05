import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { handshake } from '../../src/session/handshake.ts'
import { XRootDUrl } from '../../src/url/url.ts'
import { File } from '../../src/api/file.ts'
import { XRootDError } from '../../src/api/errors.ts'
import type { Session } from '../../src/session/handshake.ts'
import {
  XROOTD_HOST,
  XROOTD_PORT,
  TEST_FILE_PATH,
  EXPECTED_FILE_CONTENTS,
  skipIfServerUnavailable,
} from './setup.ts'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ])
}

async function createConnectedClient(): Promise<{
  transport: Transport
  mux: Multiplexer
  session: Session
}> {
  const transport = new Transport()
  await transport.connect(XROOTD_HOST, XROOTD_PORT)
  const mux = new Multiplexer(transport)
  const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`)
  const session = await withTimeout(
    handshake(mux, url),
    5000,
    'handshake with xrootd server',
  )
  return { transport, mux, session }
}

describe('Integration: file read flow', () => {
  before(async function () {
    await skipIfServerUnavailable.call(this)
  })

  it('login -> open -> read -> close', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)
      await file.open(TEST_FILE_PATH)
      assert.equal(file.isOpen, true, 'file should be open')

      const data = await file.read(0, EXPECTED_FILE_CONTENTS.length)
      const text = new TextDecoder().decode(data)
      assert.equal(text, EXPECTED_FILE_CONTENTS)

      await file.close()
      assert.equal(file.isOpen, false, 'file should be closed')
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('read with offset and size', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)
      await file.open(TEST_FILE_PATH)

      const data = await file.read(0, 5)
      const text = new TextDecoder().decode(data)
      assert.equal(text, 'Hello')

      await file.close()
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('read with offset skips bytes', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)
      await file.open(TEST_FILE_PATH)

      const data = await file.read(7, 5)
      const text = new TextDecoder().decode(data)
      assert.equal(text, 'XRootD')

      await file.close()
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('open non-existent file throws XRootDError', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)

      try {
        await file.open('/test/nonexistent_file_12345.txt')
        assert.fail('Expected XRootDError')
      } catch (err) {
        assert.ok(err instanceof XRootDError, 'should throw XRootDError')
        assert.equal(err.code, 3011, 'error code should be 3011 (NotFound)')
      }
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('stat on opened file returns valid info', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)
      await file.open(TEST_FILE_PATH)

      const info = await file.stat()
      assert.ok(info, 'stat info should be defined')
      assert.ok(info.size > 0, 'file size should be > 0')

      await file.close()
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('multiple sequential reads', async () => {
    const { transport, mux, session } = await createConnectedClient()

    try {
      const file = new File(mux, session)
      await file.open(TEST_FILE_PATH)

      const chunk1 = await file.read(0, 5)
      const chunk2 = await file.read(5, 5)
      const chunk3 = await file.read(10, 5)

      assert.equal(new TextDecoder().decode(chunk1), 'Hello')
      assert.equal(new TextDecoder().decode(chunk2), ', XRoo')
      assert.equal(new TextDecoder().decode(chunk3), 'tD!Th')

      await file.close()
    } finally {
      mux.close()
      await transport.close()
    }
  })
})
