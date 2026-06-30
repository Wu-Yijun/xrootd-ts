import { Multiplexer } from '../transport/multiplexer.js'
import type { Session } from './handshake.js'
import {
  buildOpenRequest,
  buildReadRequest,
  buildWriteRequest,
  buildCloseRequest,
  buildStatRequest,
  parseOpenResponse,
} from '../protocol/message.js'
import { ResponseStatus } from '../protocol/constants.js'
import { XRootDError } from './errors.js'

export interface StatInfo {
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

export class File {
  private mux: Multiplexer
  private session: Session
  private fhandle: Uint8Array | null = null
  private _isOpen = false

  constructor(mux: Multiplexer, session: Session) {
    this.mux = mux
    this.session = session
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  async open(path: string, options?: { flags?: number; mode?: number }): Promise<void> {
    if (this._isOpen) {
      throw new XRootDError(3004, 'File is already open')
    }

    const flags = options?.flags ?? 0x0010 // kXR_open_read
    const mode = options?.mode ?? 0

    const body = new Uint8Array(16)
    const frame = await this.mux.request(
      3010, // RequestId.Open
      body,
      Buffer.from(path),
    )

    if (frame.status === ResponseStatus.Error) {
      const errnum = frame.body.readInt32BE(0)
      const errmsg = frame.body.toString('utf-8', 4).replace(/\0+$/, '')
      throw new XRootDError(errnum, errmsg)
    }

    if (frame.status === ResponseStatus.Ok) {
      const resp = parseOpenResponse(frame.body)
      this.fhandle = resp.fhandle
      this._isOpen = true
      return
    }

    throw new XRootDError(3012, `Unexpected open response status: ${frame.status}`)
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, 'File is not open')
    }

    const body = new Uint8Array(16)
    body.set(this.fhandle, 0) // fhandle[4] at offset 0 of body
    // offset as int64 BE at offset 4 of body
    body[8] = 0
    body[9] = 0
    body[10] = 0
    body[11] = 0
    body[12] = (offset >>> 24) & 0xff
    body[13] = (offset >>> 16) & 0xff
    body[14] = (offset >>> 8) & 0xff
    body[15] = offset & 0xff
    // rlen at offset 16 of request body... actually rlen is at offset 16-19 of the 24-byte header

    const frame = await this.mux.request(
      3013, // RequestId.Read
      body,
    )

    if (frame.status === ResponseStatus.Error) {
      const errnum = frame.body.readInt32BE(0)
      const errmsg = frame.body.toString('utf-8', 4).replace(/\0+$/, '')
      throw new XRootDError(errnum, errmsg)
    }

    if (frame.status === ResponseStatus.Ok) {
      return new Uint8Array(frame.body)
    }

    throw new XRootDError(3012, `Unexpected read response status: ${frame.status}`)
  }

  async write(offset: number, data: Uint8Array): Promise<number> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, 'File is not open')
    }

    const body = new Uint8Array(16)
    body.set(this.fhandle, 0) // fhandle[4]
    // offset as int64 BE
    body[8] = 0
    body[9] = 0
    body[10] = 0
    body[11] = 0
    body[12] = (offset >>> 24) & 0xff
    body[13] = (offset >>> 16) & 0xff
    body[14] = (offset >>> 8) & 0xff
    body[15] = offset & 0xff

    const frame = await this.mux.request(
      3019, // RequestId.Write
      body,
      data,
    )

    if (frame.status === ResponseStatus.Error) {
      const errnum = frame.body.readInt32BE(0)
      const errmsg = frame.body.toString('utf-8', 4).replace(/\0+$/, '')
      throw new XRootDError(errnum, errmsg)
    }

    if (frame.status === ResponseStatus.Ok) {
      return frame.dlen
    }

    throw new XRootDError(3012, `Unexpected write response status: ${frame.status}`)
  }

  async close(): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      return
    }

    const body = new Uint8Array(16)
    body.set(this.fhandle, 0) // fhandle[4]

    const frame = await this.mux.request(
      3003, // RequestId.Close
      body,
    )

    this.fhandle = null
    this._isOpen = false

    if (frame.status === ResponseStatus.Error) {
      const errnum = frame.body.readInt32BE(0)
      const errmsg = frame.body.toString('utf-8', 4).replace(/\0+$/, '')
      throw new XRootDError(errnum, errmsg)
    }
  }

  async stat(): Promise<StatInfo> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, 'File is not open')
    }

    const body = new Uint8Array(16)
    body.set(this.fhandle, 12) // fhandle[4] at offset 12-15

    const frame = await this.mux.request(
      3017, // RequestId.Stat
      body,
    )

    if (frame.status === ResponseStatus.Error) {
      const errnum = frame.body.readInt32BE(0)
      const errmsg = frame.body.toString('utf-8', 4).replace(/\0+$/, '')
      throw new XRootDError(errnum, errmsg)
    }

    if (frame.status === ResponseStatus.Ok) {
      return parseStatInfo(frame.body)
    }

    throw new XRootDError(3012, `Unexpected stat response status: ${frame.status}`)
  }
}

function parseStatInfo(body: Buffer): StatInfo {
  const text = body.toString('utf-8').trim()
  const parts = text.split(/\s+/)

  const flags = parseInt(parts[4] ?? '0', 10) || 0

  const info: StatInfo = {
    id: parseInt(parts[0] ?? '0', 10) || 0,
    size: parseInt(parts[1] ?? '0', 10) || 0,
    mtime: parseInt(parts[3] ?? '0', 10) || 0,
    flags,
    get isDirectory() {
      return (this.flags & 0x4000) !== 0
    },
    get isLink() {
      return (this.flags & 0x8000) !== 0
    },
    get isOffline() {
      return (this.flags & 0x10000) !== 0
    },
    get isCached() {
      return (this.flags & 0x20000) !== 0
    },
  }

  return info
}
