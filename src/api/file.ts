import { Multiplexer } from "../transport/multiplexer.ts";
import type { Session } from "../session/handshake.ts";
import {
  buildCloseRequest,
  buildOpenRequest,
  buildReadRequest,
  buildStatRequest,
  buildSyncRequest,
  buildTruncateRequest,
  buildWriteRequest,
  parseErrorResponse,
  parseOpenResponse,
} from "../protocol/message.ts";
import {
  OpenFlags,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import { XRootDError } from "./errors.ts";
import { createStatInfo, type StatInfo } from "./types.ts";
import { sendRequest } from "../utils/request.ts";

export class File {
  private mux: Multiplexer;
  private session: Session;
  private fhandle: Uint8Array | null = null;
  private _isOpen = false;

  constructor(mux: Multiplexer, session: Session) {
    this.mux = mux;
    this.session = session;
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
    const frame = await sendRequest(this.mux, buf, Buffer.from(path));

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }

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
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }

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
    const frame = await sendRequest(this.mux, buf, data);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }

    if (frame.status === ResponseStatus.Ok) {
      return frame.dlen;
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
    const frame = await sendRequest(this.mux, buf);

    this.fhandle = null;
    this._isOpen = false;

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }
  }

  async stat(): Promise<StatInfo> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildStatRequest(0, "", this.fhandle);
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }

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
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }
  }

  async truncate(size: number): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(ServerError.FileNotOpen, "File is not open");
    }

    const buf = buildTruncateRequest(0, this.fhandle, size);
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }
  }
}

function parseStatInfo(body: Buffer): StatInfo {
  return createStatInfo(body.toString("utf-8"));
}
