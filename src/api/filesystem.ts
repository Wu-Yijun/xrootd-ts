import type { Multiplexer } from "../transport/multiplexer.ts";
import {
  buildDirlistRequest,
  buildMkdirRequest,
  buildMvRequest,
  buildRmdirRequest,
  buildRmRequest,
  buildStatRequest,
  parseDirlistResponse,
} from "../protocol/message.ts";
import { DirlistOptions, DEFAULT_DIR_MODE } from "../protocol/constants.ts";
import { assertOkFrame } from "./errors.ts";
import type { DirectoryList, StatInfo } from "./types.ts";
import { createStatInfo } from "./types.ts";
import { sendRequest } from "../utils/request.ts";

export class FileSystem {
  private readonly getMux: () => Multiplexer;

  constructor(getMux: () => Multiplexer) {
    this.getMux = getMux;
  }

  async stat(path: string): Promise<StatInfo> {
    const req = buildStatRequest(0, path);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);
    return createStatInfo(frame.body.toString("utf8"));
  }

  async readdir(path: string, options?: { dstat?: boolean }): Promise<DirectoryList> {
    const flags = options?.dstat ? DirlistOptions.Dstat : 0;
    const req = buildDirlistRequest(0, path, flags);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);

    const { entries } = parseDirlistResponse(frame.body);
    return { name: path, entries };
  }

  async mkdir(path: string, mode: number = DEFAULT_DIR_MODE): Promise<void> {
    const req = buildMkdirRequest(0, path, mode);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);
  }

  async rmdir(path: string): Promise<void> {
    const req = buildRmdirRequest(0, path);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);
  }

  async rm(path: string): Promise<void> {
    const req = buildRmRequest(0, path);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);
  }

  async mv(source: string, target: string): Promise<void> {
    const req = buildMvRequest(0, source, target);
    const frame = await sendRequest(this.getMux(), req);
    assertOkFrame(frame);
  }
}
