import type { Multiplexer } from '../transport/multiplexer.ts'
import type { Frame } from '../transport/framer.ts'
import {
  buildStatRequest,
  buildDirlistRequest,
  buildMkdirRequest,
  buildRmdirRequest,
  buildRmRequest,
  buildMvRequest,
  parseErrorResponse,
  parseDirlistResponse,
} from '../protocol/message.ts'
import { RequestId, ResponseStatus } from '../protocol/constants.ts'
import { XRootDError } from './errors.ts'
import type { StatInfo, DirectoryList } from './types.ts'

function createStatInfo(data: string): StatInfo {
  const parts = data.trim().split(/\s+/)
  const id = parseInt(parts[0], 10) || 0
  const size = parseInt(parts[1], 10) || 0
  const mtime = parseInt(parts[3], 10) || 0
  const modeStr = parts[6] ?? '0'
  const mode = parseInt(modeStr, 8) || 0
  const flags = mode

  return {
    id,
    size,
    mtime,
    flags,
    get isDirectory() { return (mode & 0o040000) !== 0 },
    get isLink() { return (mode & 0o120000) === 0o120000 },
    get isOffline() { return false },
    get isCached() { return false },
  }
}

function extractBody(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.subarray(4, 20))
}

function extractExtraData(buf: Buffer): Uint8Array | undefined {
  const dlen = buf.readUInt32BE(20)
  if (dlen === 0) return undefined
  return new Uint8Array(buf.subarray(24, 24 + dlen))
}

export class FileSystem {
  private mux: Multiplexer

  constructor(mux: Multiplexer) {
    this.mux = mux
  }

  async stat(path: string): Promise<StatInfo> {
    const req = buildStatRequest(0, path)
    const frame = await this.mux.request(RequestId.Stat, extractBody(req), extractExtraData(req))
    this.handleError(frame)
    return createStatInfo(frame.body.toString('utf8'))
  }

  async readdir(path: string): Promise<DirectoryList> {
    const req = buildDirlistRequest(0, path)
    const frame = await this.mux.request(RequestId.Dirlist, extractBody(req), extractExtraData(req))
    this.handleError(frame)

    const { entries } = parseDirlistResponse(frame.body)
    return { name: path, entries }
  }

  async mkdir(path: string, mode: number = 0o755): Promise<void> {
    const req = buildMkdirRequest(0, path, mode)
    const frame = await this.mux.request(RequestId.Mkdir, extractBody(req), extractExtraData(req))
    this.handleError(frame)
  }

  async rmdir(path: string): Promise<void> {
    const req = buildRmdirRequest(0, path)
    const frame = await this.mux.request(RequestId.Rmdir, extractBody(req), extractExtraData(req))
    this.handleError(frame)
  }

  async rm(path: string): Promise<void> {
    const req = buildRmRequest(0, path)
    const frame = await this.mux.request(RequestId.Rm, extractBody(req), extractExtraData(req))
    this.handleError(frame)
  }

  async mv(source: string, target: string): Promise<void> {
    const req = buildMvRequest(0, source, target)
    const frame = await this.mux.request(RequestId.Mv, extractBody(req), extractExtraData(req))
    this.handleError(frame)
  }

  private handleError(frame: Frame): void {
    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
      throw new XRootDError(errnum, errmsg)
    }
  }
}
