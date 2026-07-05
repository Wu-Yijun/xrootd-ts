// Client
export { XRootDClient } from './client.ts'
export type { XRootDClientOptions } from './client.ts'

// API layer
export { File } from './api/file.ts'
export type { StatInfo } from './api/file.ts'
export { FileSystem } from './api/filesystem.ts'
export { XRootDError } from './api/errors.ts'
export type {
  OpenOptions,
  ChunkInfo,
  Location,
  LocationInfo,
  DirectoryListInfo,
  DirectoryList,
  DirectoryEntry,
  ProtocolInfo,
  AuthConfig,
} from './api/types.ts'

// Transport layer
export { Transport } from './transport/transport.ts'
export type { ITransport } from './transport/interface.ts'
export { Multiplexer } from './transport/multiplexer.ts'
export { Framer } from './transport/framer.ts'
export type { Frame } from './transport/framer.ts'

// Session layer
export { handshake } from './session/handshake.ts'
export type { Session } from './session/handshake.ts'

// URL
export { XRootDUrl } from './url/url.ts'

// Protocol
export * from './protocol/constants.ts'
export {
  buildHandshakeAndProtocol,
  buildLoginRequest,
  buildOpenRequest,
  buildReadRequest,
  buildWriteRequest,
  buildCloseRequest,
  buildStatRequest,
  parseProtocolResponse,
  parseLoginResponse,
  parseOpenResponse,
  parseErrorResponse,
  parseRedirectResponse,
  parseWaitResponse,
} from './protocol/message.ts'
export type {
  ProtocolResponse,
  LoginResponse,
  OpenResponse,
  ErrorResponse,
  RedirectResponse,
  WaitResponse,
} from './protocol/message.ts'

// Codec
export {
  put16,
  put32,
  get16,
  get32,
  putString,
  getString,
  putBytes,
  getBytes,
} from './protocol/codec.ts'
