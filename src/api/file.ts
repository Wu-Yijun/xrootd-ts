import { Multiplexer } from "../transport/multiplexer.ts";
import {
  buildCloseRequest,
  buildOpenRequest,
  buildReadRequest,
  buildStatRequest,
  buildSyncRequest,
  buildTruncateRequest,
  buildWriteRequest,
  parseOpenResponse,
} from "../protocol/message.ts";
import {
  OpenFlags,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import { XRootDError, assertOkFrame } from "./errors.ts";
import { createStatInfo, type StatInfo } from "./types.ts";
import { sendRequest } from "../utils/request.ts";

export class File {
  private readonly getMux: () => Multiplexer;
  private fhandle: Uint8Array | null = null;
  private _isOpen = false;

  constructor(getMux: () => Multiplexer) {
    this.getMux = getMux;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async open(
    path: string,
    options?: { flags?: number; mode?: number },
  ): Promise<void> {
    if (this._isOpen) {
      throw new XRootDError(ServerError.FileNotOpen, "File is already open");
    }

    const flags = options?.flags ?? OpenFlags.Read;
    const mode = options?.mode ?? 0;

    const buf = buildOpenRequest(0, path, flags, mode);
    const frame = await sendRequest(this.getMux(), buf, Buffer.from(path));

    assertOkFrame(frame);

    if (frame.status === ResponseStatus.Ok) {
      const resp = parseOpenResponse(frame.body);
      this.fhandle = resp.fhandle;
      this._isOpen = true;
      return;
    }

    throw new XRootDError(
      ServerError.ServerError,
      `Unexpected open response status: ${frame.status}`,
    );
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildReadRequest(0, this.fhandle, offset, size);
    const frame = await sendRequest(this.getMux(), buf);

    assertOkFrame(frame);

    if (
      frame.status === ResponseStatus.Ok ||
      frame.status === ResponseStatus.Oksofar
    ) {
      return new Uint8Array(frame.body);
    }

    throw new XRootDError(
      ServerError.ServerError,
      `Unexpected read response status: ${frame.status}`,
    );
  }

  async write(offset: number, data: Uint8Array): Promise<number> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildWriteRequest(0, this.fhandle, offset, data);
    const frame = await sendRequest(this.getMux(), buf, data);

    assertOkFrame(frame);

    if (frame.status === ResponseStatus.Ok) {
      return frame.dlen > 0 ? frame.dlen : data.length;
    }

    throw new XRootDError(
      ServerError.ServerError,
      `Unexpected write response status: ${frame.status}`,
    );
  }

  async close(): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      return;
    }

    const buf = buildCloseRequest(0, this.fhandle);
    const frame = await sendRequest(this.getMux(), buf);

    this.fhandle = null;
    this._isOpen = false;

    assertOkFrame(frame);
  }

  async stat(): Promise<StatInfo> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildStatRequest(0, "", this.fhandle);
    const frame = await sendRequest(this.getMux(), buf);

    assertOkFrame(frame);

    if (frame.status === ResponseStatus.Ok) {
      return parseStatInfo(frame.body);
    }

    throw new XRootDError(
      ServerError.ServerError,
      `Unexpected stat response status: ${frame.status}`,
    );
  }

  async sync(): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildSyncRequest(0, this.fhandle);
    const frame = await sendRequest(this.getMux(), buf);

    assertOkFrame(frame);
  }

  async truncate(size: number): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildTruncateRequest(0, this.fhandle, size);
    const frame = await sendRequest(this.getMux(), buf);

    assertOkFrame(frame);
  }
}

function parseStatInfo(body: Buffer): StatInfo {
  return createStatInfo(body.toString("utf-8"));
}
