// Client
export { XRootDClient } from "./client.ts";
export type { XRootDClientOptions } from "./client.ts";

// Config layer
export { SecEnv } from "./config/sec-env.ts";
export type { SecEnvOptions } from "./config/sec-env.ts";
export { loadAuthConfig } from "./config/loader.ts";
export type { ResolvedAuthConfig } from "./config/loader.ts";

// API layer
export { File } from "./api/file.ts";
export type { StatInfo } from "./api/types.ts";
export { createStatInfo, StatFlags } from "./api/types.ts";
export { FileSystem } from "./api/filesystem.ts";
export { XRootDError } from "./api/errors.ts";
export type {
  AuthConfig,
  ChunkInfo,
  DirectoryEntry,
  DirectoryList,
  Location,
  LocationInfo,
  OpenOptions,
  ProtocolInfo,
} from "./api/types.ts";

// Transport layer
export { Transport } from "./transport/transport.ts";
export type { ITransport } from "./transport/interface.ts";
export { Multiplexer } from "./transport/multiplexer.ts";
export { Framer } from "./transport/framer.ts";
export type { Frame } from "./transport/framer.ts";

// Session layer
export { handshake } from "./session/handshake.ts";
export type { Session } from "./session/handshake.ts";

// URL
export { XRootDUrl } from "./url/url.ts";

// Protocol
export * from "./protocol/constants.ts";
export { Message } from "./protocol/message-class.ts";
export {
  buildCloseRequest,
  buildHandshakeAndProtocol,
  buildLoginRequest,
  buildOpenRequest,
  buildReadRequest,
  buildStatRequest,
  buildWriteRequest,
  parseErrorResponse,
  parseLoginResponse,
  parseOpenResponse,
  parseProtocolResponse,
  parseRedirectResponse,
  parseWaitResponse,
} from "./protocol/message.ts";
export type {
  ErrorResponse,
  LoginResponse,
  OpenResponse,
  ProtocolResponse,
  RedirectResponse,
  WaitResponse,
} from "./protocol/message.ts";

// Codec
export {
  get16,
  get32,
  getBytes,
  getString,
  put16,
  put32,
  putBytes,
  putString,
} from "./protocol/codec.ts";
