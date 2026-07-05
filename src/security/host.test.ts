import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HostAuth } from './host.ts'
import type { AuthParams } from './interface.ts'

describe('HostAuth', () => {
  const defaultParams: AuthParams = {
    host: 'testhost.example.com',
    port: 1094,
    username: 'testuser',
    sessid: new Uint8Array(16),
  }

  it('has correct name', () => {
    const auth = new HostAuth()
    assert.equal(auth.name, 'host')
  })

  it('returns hostname as credentials', async () => {
    const auth = new HostAuth()
    const creds = await auth.getCredentials(defaultParams)
    const decoded = new TextDecoder().decode(creds)
    assert.equal(decoded, 'testhost.example.com')
  })

  it('returns "unknown" when host is empty', async () => {
    const auth = new HostAuth()
    const creds = await auth.getCredentials({ ...defaultParams, host: '' })
    const decoded = new TextDecoder().decode(creds)
    assert.equal(decoded, 'unknown')
  })

  it('processChallenge marks as complete', async () => {
    const auth = new HostAuth()
    assert.equal(auth.isComplete(), false)

    const response = await auth.processChallenge(new Uint8Array(0))
    assert.equal(auth.isComplete(), true)
    assert.equal(response.length, 0)
  })

  it('returns correct entity', () => {
    const auth = new HostAuth()
    const entity = auth.getEntity()
    assert.equal(entity.prot, 'host')
    assert.equal(entity.uid, 0)
    assert.equal(entity.gid, 0)
  })
})
