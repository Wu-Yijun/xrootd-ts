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
import { ResponseStatus } from "../protocol/constants.ts";
import { XRootDError } from "./errors.ts";
import { type StatInfo, createStatInfo } from "./types.ts";

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
      throw new XRootDError(3004, "File is already open");
    }

    const flags = options?.flags ?? 0x0010; // kXR_open_read
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
      3012,
      `Unexpected open response status: ${frame.status}`,
    );
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, "File is not open");
    }

    const buf = buildReadRequest(0, this.fhandle, offset, size);
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }

    if (frame.status === ResponseStatus.Ok) {
      return new Uint8Array(frame.body);
    }

    throw new XRootDError(
      3012,
      `Unexpected read response status: ${frame.status}`,
    );
  }

  async write(offset: number, data: Uint8Array): Promise<number> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, "File is not open");
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
      3012,
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
      throw new XRootDError(3004, "File is not open");
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
      3012,
      `Unexpected stat response status: ${frame.status}`,
    );
  }

  async sync(): Promise<void> {
    if (!this._isOpen || !this.fhandle) {
      throw new XRootDError(3004, "File is not open");
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
      throw new XRootDError(3004, "File is not open");
    }

    const buf = buildTruncateRequest(0, this.fhandle, size);
    const frame = await sendRequest(this.mux, buf);

    if (frame.status === ResponseStatus.Error) {
      const { errnum, errmsg } = parseErrorResponse(frame.body);
      throw new XRootDError(errnum, errmsg);
    }
  }
}

async function sendRequest(
  mux: Multiplexer,
  buf: Buffer,
  data?: Uint8Array,
) {
  const requestId = buf.readUInt16BE(2);
  const body = new Uint8Array(buf.subarray(4, 20));
  const dlen = buf.readUInt32BE(20);
  const extraData = data ??
    (dlen > 0 ? new Uint8Array(buf.subarray(24, 24 + dlen)) : undefined);
  return mux.request(requestId, body, extraData);
}

function parseStatInfo(body: Buffer): StatInfo {
  return createStatInfo(body.toString("utf-8"));
}
