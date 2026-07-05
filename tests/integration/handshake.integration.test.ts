import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { handshake } from '../../src/session/handshake.ts'
import { XRootDUrl } from '../../src/url/url.ts'
import { XRootDClient } from '../../src/client.ts'
import {
  XROOTD_HOST,
  XROOTD_PORT,
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

describe('Integration: handshake', () => {
  before(skipIfServerUnavailable)

  it('handshake() returns Session with valid sessid and protocolVersion', async () => {
    const transport = new Transport()
    await transport.connect(XROOTD_HOST, XROOTD_PORT)
    const mux = new Multiplexer(transport)

    try {
      const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`)
      const session = await withTimeout(
        handshake(mux, url),
        5000,
        'handshake with xrootd server',
      )

      assert.ok(session, 'session should be defined')
      assert.ok(session.sessid, 'sessid should be defined')
      assert.equal(session.sessid.length, 16, 'sessid should be 16 bytes')
      assert.ok(
        session.protocolVersion > 0,
        `protocolVersion should be positive, got 0x${session.protocolVersion.toString(16)}`,
      )
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('handshake() with username returns valid Session', async () => {
    const transport = new Transport()
    await transport.connect(XROOTD_HOST, XROOTD_PORT)
    const mux = new Multiplexer(transport)

    try {
      const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`)
      const session = await withTimeout(
        handshake(mux, url, { username: 'testuser', pid: 12345 }),
        5000,
        'handshake with username',
      )

      assert.ok(session.sessid.length === 16)
      assert.ok(session.protocolVersion > 0)
    } finally {
      mux.close()
      await transport.close()
    }
  })

  it('XRootDClient.connect() completes full handshake', async () => {
    const client = new XRootDClient(
      `root://${XROOTD_HOST}:${XROOTD_PORT}/`,
    )

    try {
      await withTimeout(
        client.connect(),
        5000,
        'client.connect()',
      )
      assert.equal(client.isConnected, true, 'client should be connected')
    } finally {
      await client.close()
    }
  })
})
