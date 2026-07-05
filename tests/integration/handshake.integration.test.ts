import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Transport } from '../../src/transport/transport.ts'
import { Multiplexer } from '../../src/transport/multiplexer.ts'
import { handshake } from '../../src/session/handshake.ts'
import { XRootDUrl } from '../../src/url/url.ts'
import {
  XROOTD_HOST,
  XROOTD_PORT,
  skipIfServerUnavailable,
} from './setup.ts'

describe('Integration: handshake', () => {
  let transport: Transport
  let mux: Multiplexer

  before(async function () {
    await skipIfServerUnavailable.call(this)
  })

  after(async () => {
    mux?.close()
    await transport?.close()
  })

  it('returns Session with valid sessid and protocolVersion', async () => {
    transport = new Transport()
    await transport.connect(XROOTD_HOST, XROOTD_PORT)
    mux = new Multiplexer(transport)

    const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`)
    const session = await handshake(mux, url)

    assert.ok(session, 'session should be defined')
    assert.ok(session.sessid, 'sessid should be defined')
    assert.equal(session.sessid.length, 16, 'sessid should be 16 bytes')
    assert.equal(session.protocolVersion, 0x520, 'protocolVersion should be 0x520')
  })

  it('returns non-zero sessid bytes', async () => {
    const transport2 = new Transport()
    await transport2.connect(XROOTD_HOST, XROOTD_PORT)
    const mux2 = new Multiplexer(transport2)

    const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`)
    const session = await handshake(mux2, url)

    const allZero = session.sessid.every((b: number) => b === 0)
    assert.equal(allZero, false, 'sessid should not be all zeros')

    mux2.close()
    await transport2.close()
  })
})
