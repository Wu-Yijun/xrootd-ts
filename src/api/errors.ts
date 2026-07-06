import {
  ClientError,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import type { Frame } from "../transport/framer.ts";
import { parseErrorResponse } from "../protocol/message.ts";

/** Error codes that can be used with XRootDError. */
export type ErrorCode = ServerError | ClientError;

const codeMessages: Record<ErrorCode, string> = {
  [ServerError.ArgInvalid]: "Invalid argument",
  [ServerError.ArgMissing]: "Missing argument",
  [ServerError.ArgTooLong]: "Argument too long",
  [ServerError.FileLocked]: "File locked",
  [ServerError.FileNotOpen]: "File not open",
  [ServerError.FSError]: "File system error",
  [ServerError.InvalidRequest]: "Invalid request",
  [ServerError.IOError]: "I/O error",
  [ServerError.NoMemory]: "No memory",
  [ServerError.NoSpace]: "No space",
  [ServerError.NotAuthorized]: "Not authorized",
  [ServerError.NotFound]: "File not found",
  [ServerError.ServerError]: "Server error",
  [ServerError.Unsupported]: "Unsupported",
  [ServerError.NoServer]: "No server",
  [ServerError.NotFile]: "Not a file",
  [ServerError.IsDirectory]: "Is a directory",
  [ServerError.Cancelled]: "Operation cancelled",
  [ServerError.ItExists]: "File already exists",
  [ServerError.CheckSumErr]: "Checksum error",
  [ServerError.InProgress]: "Operation in progress",
  [ServerError.OverQuota]: "Over quota",
  [ServerError.SigVerErr]: "Signature verification error",
  [ServerError.DecryptErr]: "Decryption error",
  [ServerError.Overloaded]: "Server overloaded",
  [ServerError.FsReadOnly]: "File system read-only",
  [ServerError.BadPayload]: "Bad payload",
  [ServerError.AttrNotFound]: "Attribute not found",
  [ServerError.TLSRequired]: "TLS required",
  [ServerError.NoReplicas]: "No replicas",
  [ServerError.AuthFailed]: "Authentication failed",
  [ServerError.Impossible]: "Impossible",
  [ServerError.Conflict]: "Conflict",
  [ServerError.TooManyErrs]: "Too many errors",
  [ServerError.ReqTimedOut]: "Request timed out",
  [ServerError.TimerExpired]: "Timer expired",
  [ClientError.Ok]: "OK",
  [ClientError.InvalidArgs]: "Invalid arguments",
  [ClientError.NotFound]: "Not found",
  [ClientError.Permission]: "Permission denied",
  [ClientError.Serialization]: "Serialization error",
  [ClientError.CommandNotFound]: "Command not found",
  [ClientError.HostNotFound]: "Host not found",
  [ClientError.ServiceUnavail]: "Service unavailable",
  [ClientError.InternalError]: "Internal error",
  [ClientError.BadRequest]: "Bad request",
  [ClientError.Timeout]: "Timeout",
  [ClientError.InsufficientData]: "Insufficient data",
  [ClientError.Uninitialized]: "Client not connected",
  [ClientError.Disconnected]: "Disconnected",
  [ClientError.Redirect]: "Redirect",
  [ClientError.LossyRetry]: "Lossy retry",
  [ClientError.TooManyRedirs]: "Too many redirects",
  [ClientError.ChunkChecksumErr]: "Chunk checksum error",
  [ClientError.UnexpectedResp]: "Unexpected response",
  [ClientError.ClientSkipped]: "Client skipped",
  [ClientError.Failed]: "Failed",
  [ClientError.WinNetworkError]: "Windows network error",
};

export class XRootDError extends Error {
  readonly code: ErrorCode | number;
  readonly errno?: number;

  constructor(code: ErrorCode | number, message?: string, errno?: number) {
    super(message ?? XRootDError.codeToMessage(code as ErrorCode));
    this.name = "XRootDError";
    this.code = code;
    this.errno = errno;
  }

  static codeToMessage(code: ErrorCode | number): string {
    return codeMessages[code as ErrorCode] ?? `Unknown error (${code})`;
  }
}

/**
 * Assert that a response frame has status kXR_ok.
 * Throws XRootDError if the frame has an error status.
 */
export function assertOkFrame(frame: Frame): void {
  if (frame.status === ResponseStatus.Error) {
    const { errnum, errmsg } = parseErrorResponse(frame.body);
    throw new XRootDError(errnum, errmsg);
  }
}
