import { ServerError } from "../protocol/constants.ts";

const codeMessages: Record<number, string> = {
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
};

export class XRootDError extends Error {
  readonly code: number;
  readonly errno?: number;

  constructor(code: number, message?: string, errno?: number) {
    super(message ?? XRootDError.codeToMessage(code));
    this.name = "XRootDError";
    this.code = code;
    this.errno = errno;
  }

  static codeToMessage(code: number): string {
    return codeMessages[code] ?? `Unknown error (${code})`;
  }
}
