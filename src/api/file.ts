import { Multiplexer } from '../transport/multiplexer.js'
import type { Session } from '../session/handshake.js'
import {
  buildOpenRequest,
  buildReadRequest,
  buildWriteRequest,
  buildCloseRequest,
  buildStatRequest,
  parseOpenResponse,
  parseErrorResponse,
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
      const { errnum, errmsg } = parseErrorResponse(frame.body)
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

    const buf = buildReadRequest(0, this.fhandle, offset, size)
    const frame = await sendRequest(this.mux, buf)

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
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

    const buf = buildWriteRequest(0, this.fhandle, offset, data)
    const frame = await sendRequest(this.mux, buf, data)

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
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

    const buf = buildCloseRequest(0, this.fhandle)
    const frame = await sendRequest(this.mux, buf)

    this.fhandle = null
    this._isOpen = false

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
      throw new XRootDError(errnum, errmsg)
    }
  }

  async stat(): Promise<StatInfo> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, 'File is not open')
    }

    const buf = buildStatRequest(0, '', this.fhandle)
    const frame = await sendRequest(this.mux, buf)

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
      throw new XRootDError(errnum, errmsg)
    }

    if (frame.status === ResponseStatus.Ok) {
      return parseStatInfo(frame.body)
    }

    throw new XRootDError(3012, `Unexpected stat response status: ${frame.status}`)
  }
}

async function sendRequest(
  mux: Multiplexer,
  buf: Buffer,
  data?: Uint8Array,
) {
  const requestId = buf.readUInt16BE(2)
  const body = new Uint8Array(buf.subarray(4, 20))
  return mux.request(requestId, body, data)
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
