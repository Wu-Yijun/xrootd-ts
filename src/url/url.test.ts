import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { XRootDUrl } from './url.ts'

describe('XRootDUrl', () => {
  it('parses full URL with host:port/path', () => {
    const url = new XRootDUrl('root://host.cern.ch:1095/data')
    assert.equal(url.protocol, 'root')
    assert.equal(url.host, 'host.cern.ch')
    assert.equal(url.port, 1095)
    assert.equal(url.path, '/data')
  })

  it('uses default port 1094 when omitted', () => {
    const url = new XRootDUrl('root://host.cern.ch/data')
    assert.equal(url.port, 1094)
  })

  it('parses roots:// secure protocol', () => {
    const url = new XRootDUrl('roots://host.cern.ch/data')
    assert.equal(url.protocol, 'roots')
    assert.equal(url.isSecure(), true)
  })

  it('parses user:pass@host:port/path', () => {
    const url = new XRootDUrl('root://alice:secret@host.cern.ch:1095/data')
    assert.equal(url.user, 'alice')
    assert.equal(url.password, 'secret')
    assert.equal(url.host, 'host.cern.ch')
    assert.equal(url.port, 1095)
    assert.equal(url.path, '/data')
  })

  it('throws on invalid protocol', () => {
    assert.throws(() => new XRootDUrl('http://host/path'), /Invalid XRootD URL protocol/)
  })

  it('isValid() returns true for root and roots', () => {
    assert.equal(new XRootDUrl('root://h/p').isValid(), true)
    assert.equal(new XRootDUrl('roots://h/p').isValid(), true)
  })

  it('isSecure() returns true only for roots', () => {
    assert.equal(new XRootDUrl('root://h/p').isSecure(), false)
    assert.equal(new XRootDUrl('roots://h/p').isSecure(), true)
  })

  it('getHostId() includes user:pass@host:port', () => {
    const url = new XRootDUrl('root://alice:s3cr3t@host.cern.ch:1095/data')
    assert.equal(url.getHostId(), 'alice:s3cr3t@host.cern.ch:1095')
  })

  it('getHostId() without auth', () => {
    const url = new XRootDUrl('root://host.cern.ch/data')
    assert.equal(url.getHostId(), 'host.cern.ch:1094')
  })

  it('getChannelId() is host:port', () => {
    const url = new XRootDUrl('root://host.cern.ch:1095/data')
    assert.equal(url.getChannelId(), 'host.cern.ch:1095')
  })

  it('getLocation() is protocol://host:port/path', () => {
    const url = new XRootDUrl('root://host.cern.ch:1095/data')
    assert.equal(url.getLocation(), 'root://host.cern.ch:1095/data')
  })

  it('toString() round-trips', () => {
    const url = new XRootDUrl('root://alice:pw@host.cern.ch:1095/data')
    const str = url.toString()
    assert.equal(str, 'root://alice:pw@host.cern.ch:1095/data')
  })

  it('toString() omits default port', () => {
    const url = new XRootDUrl('root://host.cern.ch/data')
    assert.equal(url.toString(), 'root://host.cern.ch/data')
  })

  it('static parse() creates instance', () => {
    const url = XRootDUrl.parse('root://host/path')
    assert.ok(url instanceof XRootDUrl)
    assert.equal(url.host, 'host')
  })

  it('parses URL without path', () => {
    const url = new XRootDUrl('root://host.cern.ch')
    assert.equal(url.path, '/')
  })
})
