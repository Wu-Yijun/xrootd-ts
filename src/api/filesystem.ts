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
  const mtime = parseInt(parts[2], 10) || 0
  const flags = parseInt(parts[3], 10) || 0

  return {
    id,
    size,
    mtime,
    flags,
    get isDirectory() { return (flags & 0x1000) !== 0 },
    get isLink() { return (flags & 0x2000) !== 0 },
    get isOffline() { return (flags & 0x4000) !== 0 },
    get isCached() { return (flags & 0x8000) !== 0 },
  }
}

export class FileSystem {
  private mux: Multiplexer

  constructor(mux: Multiplexer) {
    this.mux = mux
  }

  async stat(path: string): Promise<StatInfo> {
    const body = buildStatRequest(0, path)
    const frame = await this.mux.request(RequestId.Stat, body)
    this.handleError(frame)
    return createStatInfo(frame.body.toString('utf8'))
  }

  async readdir(path: string): Promise<DirectoryList> {
    const body = buildDirlistRequest(0, path)
    const frame = await this.mux.request(RequestId.Dirlist, body)
    this.handleError(frame)

    const { entries } = parseDirlistResponse(frame.body)
    return { name: path, entries }
  }

  async mkdir(path: string, mode: number = 0o755): Promise<void> {
    const body = buildMkdirRequest(0, path, mode)
    const frame = await this.mux.request(RequestId.Mkdir, body)
    this.handleError(frame)
  }

  async rmdir(path: string): Promise<void> {
    const body = buildRmdirRequest(0, path)
    const frame = await this.mux.request(RequestId.Rmdir, body)
    this.handleError(frame)
  }

  async rm(path: string): Promise<void> {
    const body = buildRmRequest(0, path)
    const frame = await this.mux.request(RequestId.Rm, body)
    this.handleError(frame)
  }

  async mv(source: string, target: string): Promise<void> {
    const body = buildMvRequest(0, source, target)
    const frame = await this.mux.request(RequestId.Mv, body)
    this.handleError(frame)
  }

  private handleError(frame: Frame): void {
    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body)
      throw new XRootDError(errnum, errmsg)
    }
  }
}
