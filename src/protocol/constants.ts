// ── Request Codes (3000–3032) ──────────────────────────────────────────────
export const RequestId = {
  Auth: 3000,
  Query: 3001,
  Chmod: 3002,
  Close: 3003,
  Dirlist: 3004,
  Gpfile: 3005,
  Protocol: 3006,
  Login: 3007,
  Mkdir: 3008,
  Mv: 3009,
  Open: 3010,
  Ping: 3011,
  Chkpoint: 3012,
  Read: 3013,
  Rm: 3014,
  Rmdir: 3015,
  Sync: 3016,
  Stat: 3017,
  Set: 3018,
  Write: 3019,
  Fattr: 3020,
  Prepare: 3021,
  Statx: 3022,
  Endsess: 3023,
  Bind: 3024,
  ReadV: 3025,
  PgWrite: 3026,
  Locate: 3027,
  Truncate: 3028,
  Sigver: 3029,
  PgRead: 3030,
  WriteV: 3031,
  Clone: 3032,
} as const;
export type RequestId = typeof RequestId[keyof typeof RequestId];

// ── Response Status Codes ──────────────────────────────────────────────────
export const ResponseStatus = {
  Ok: 0,
  Oksofar: 4000,
  Attn: 4001,
  Authmore: 4002,
  Error: 4003,
  Redirect: 4004,
  Wait: 4005,
  Waitresp: 4006,
  Status: 4007,
} as const;
export type ResponseStatus = typeof ResponseStatus[keyof typeof ResponseStatus];

// ── Server Error Codes (kXR_error body errnum) ─────────────────────────────
export const ServerError = {
  ArgInvalid: 3000,
  ArgMissing: 3001,
  ArgTooLong: 3002,
  FileLocked: 3003,
  FileNotOpen: 3004,
  FSError: 3005,
  InvalidRequest: 3006,
  IOError: 3007,
  NoMemory: 3008,
  NoSpace: 3009,
  NotAuthorized: 3010,
  NotFound: 3011,
  ServerError: 3012,
  Unsupported: 3013,
  NoServer: 3014,
  NotFile: 3015,
  IsDirectory: 3016,
  Cancelled: 3017,
  ItExists: 3018,
  CheckSumErr: 3019,
  InProgress: 3020,
  OverQuota: 3021,
  SigVerErr: 3022,
  DecryptErr: 3023,
  Overloaded: 3024,
  FsReadOnly: 3025,
  BadPayload: 3026,
  AttrNotFound: 3027,
  TLSRequired: 3028,
  NoReplicas: 3029,
  AuthFailed: 3030,
  Impossible: 3031,
  Conflict: 3032,
  TooManyErrs: 3033,
  ReqTimedOut: 3034,
  TimerExpired: 3035,
} as const;
export type ServerError = typeof ServerError[keyof typeof ServerError];

// ── Client Error Codes (library-internal) ──────────────────────────────────
export const ClientError = {
  Ok: 0,
  InvalidArgs: 300,
  NotFound: 301,
  Permission: 302,
  Serialization: 303,
  CommandNotFound: 304,
  HostNotFound: 305,
  ServiceUnavail: 306,
  InternalError: 307,
  BadRequest: 308,
  Timeout: 309,
  InsufficientData: 310,
  Uninitialized: 311,
  Disconnected: 312,
  Redirect: 313,
  LossyRetry: 314,
  TooManyRedirs: 315,
  ChunkChecksumErr: 316,
  UnexpectedResp: 317,
  ClientSkipped: 318,
  Failed: 501,
  WinNetworkError: 601,
} as const;
export type ClientError = typeof ClientError[keyof typeof ClientError];

// ── Open Flags (kXR_open options field) ────────────────────────────────────
export const OpenFlags = {
  Read: 0x0010,
  Write: 0x0020,
  Append: 0x0200,
  New: 0x0008,
  Delete: 0x0002,
  Force: 0x0004,
  Compress: 0x0001,
  Async: 0x0040,
  Refresh: 0x0080,
  Mkpath: 0x0100,
  Retstat: 0x0400,
  Replica: 0x0800,
  Posc: 0x1000,
  Nowait: 0x2000,
  Seqio: 0x4000,
  Wrto: 0x8000,
} as const;
export type OpenFlags = typeof OpenFlags[keyof typeof OpenFlags];

// ── Protocol version (5.2.0) ──────────────────────────────────────────────
export const PROTOCOL_VERSION = 0x00000520;

// ── Header / body sizes ────────────────────────────────────────────────────
export const REQUEST_HDR_SIZE = 24;
export const RESPONSE_HDR_SIZE = 8;
export const BODY_SIZE = 16;
export const SESS_ID_SIZE = 16;
export const FHANDLE_SIZE = 4;

// ── Request header field offsets ──────────────────────────────────────────
export const REQUEST_OFFSET_STREAM_ID = 0;
export const REQUEST_OFFSET_REQUEST_ID = 2;
export const REQUEST_OFFSET_BODY = 4;
export const REQUEST_OFFSET_DLEN = 20;

// ── Response header field offsets ─────────────────────────────────────────
export const RESPONSE_OFFSET_STREAM_ID = 0;
export const RESPONSE_OFFSET_STATUS = 2;
export const RESPONSE_OFFSET_DLEN = 4;
export const RESPONSE_OFFSET_BODY = 8;

// ── ClientInitHandShake constants ──────────────────────────────────────────
export const HANDSHAKE_FIRST = 0;
export const HANDSHAKE_SECOND = 0;
export const HANDSHAKE_THIRD = 0;
export const HANDSHAKE_FOURTH = 4;
export const HANDSHAKE_FIFTH = 2012;

// ── TLS flags (kXR_protocol flags field) ──────────────────────────────────
export const kXR_secreqs = 0x01;
export const kXR_ableTLS = 0x02;
export const kXR_wantTLS = 0x04;
export const kXR_bifreqs = 0x08;

// ── Expect values (kXR_protocol expect field) ─────────────────────────────
export const kXR_ExpLogin = 0x01;
export const kXR_ExpBind = 0x02;

// ── Default XRootD port ───────────────────────────────────────────────────
export const DEFAULT_PORT = 1094;

// ── File mode flags ──────────────────────────────────────────────────────
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;

// ── Authentication credential types ─────────────────────────────────────
export const CRED_TYPE: Record<string, number> = {
  host: 0,
  sss: 1,
  unix: 2,
  krb5: 3,
  gsi: 4,
};
