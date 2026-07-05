import type { Multiplexer } from "../transport/multiplexer.ts";
import type { Frame } from "../transport/framer.ts";
import {
  buildDirlistRequest,
  buildMkdirRequest,
  buildMvRequest,
  buildRmdirRequest,
  buildRmRequest,
  buildStatRequest,
  parseDirlistResponse,
  parseErrorResponse,
} from "../protocol/message.ts";
import { RequestId, ResponseStatus } from "../protocol/constants.ts";
import { XRootDError } from "./errors.ts";
import type { DirectoryList, StatInfo } from "./types.ts";
import { createStatInfo } from "./types.ts";
import { extractBody, extractExtraData } from "../utils/request.ts";

export class FileSystem {
  private mux: Multiplexer;

  constructor(mux: Multiplexer) {
    this.mux = mux;
  }

  async stat(path: string): Promise<StatInfo> {
    const req = buildStatRequest(0, path);
    const frame = await this.mux.request(
      RequestId.Stat,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);
    return createStatInfo(frame.body.toString("utf8"));
  }

  async readdir(path: string): Promise<DirectoryList> {
    const req = buildDirlistRequest(0, path);
    const frame = await this.mux.request(
      RequestId.Dirlist,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);

    const { entries } = parseDirlistResponse(frame.body);
    return { name: path, entries };
  }

  async mkdir(path: string, mode: number = 0o755): Promise<void> {
    const req = buildMkdirRequest(0, path, mode);
    const frame = await this.mux.request(
      RequestId.Mkdir,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);
  }

  async rmdir(path: string): Promise<void> {
    const req = buildRmdirRequest(0, path);
    const frame = await this.mux.request(
      RequestId.Rmdir,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);
  }

  async rm(path: string): Promise<void> {
    const req = buildRmRequest(0, path);
    const frame = await this.mux.request(
      RequestId.Rm,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);
  }

  async mv(source: string, target: string): Promise<void> {
    const req = buildMvRequest(0, source, target);
    const frame = await this.mux.request(
      RequestId.Mv,
      extractBody(req),
      extractExtraData(req),
    );
    this.handleError(frame);
  }

  private handleError(frame: Frame): void {
    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }
  }
}
