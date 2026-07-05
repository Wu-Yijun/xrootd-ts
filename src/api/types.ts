import type { OpenFlags } from '../protocol/constants.ts'

export interface OpenOptions {
  flags?: OpenFlags
  mode?: number
  signal?: AbortSignal
}

export interface StatInfo {
  id: number
  size: number
  mtime: number
  flags: number
  get isDirectory(): boolean
  get isLink(): boolean
  get isOffline(): boolean
  get isCached(): boolean
}

export interface ChunkInfo {
  fhandle: Uint8Array
  offset: number
  length: number
  data?: Uint8Array
}

export interface Location {
  host: string
  port: number
}

export interface LocationInfo {
  locations: Location[]
  get isServer(): boolean
  get isManager(): boolean
  get isRedirect(): boolean
}

export interface DirectoryListInfo {
  name: string
  size: number
  mtime: number
  flags: number
}

export interface DirectoryList {
  name: string
  entries: DirectoryListInfo[]
}

export interface ProtocolInfo {
  version: number
  flags: number
}

export interface AuthConfig {
  username?: string
  password?: string
  protocol?: string
}

export interface ClientOptions {
  credentials?: AuthConfig
  timeout?: number
  maxRedirects?: number
}

export interface DirectoryEntry {
  name: string
  size: number
  flags: number
  mtime: number
}
