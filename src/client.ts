import { XRootDUrl } from './url/url.ts'
import { Transport } from './transport/transport.ts'
import { Multiplexer } from './transport/multiplexer.ts'
import { handshake } from './session/handshake.ts'
import { File } from './api/file.ts'
import type { Session } from './session/handshake.ts'
import type { StatInfo } from './api/file.ts'
import { XRootDError } from './api/errors.ts'

export interface XRootDClientOptions {
  credentials?: {
    username: string
    password?: string
  }
  timeout?: number
  maxRedirects?: number
}

export class XRootDClient {
  private readonly url: XRootDUrl
  private readonly options: XRootDClientOptions
  private transport: Transport | null = null
  private mux: Multiplexer | null = null
  private session: Session | null = null

  constructor(url: string, options: XRootDClientOptions = {}) {
    this.url = XRootDUrl.parse(url)
    this.options = options
  }

  async connect(): Promise<void> {
    this.transport = new Transport()
    await this.transport.connect(this.url.host, this.url.port)

    this.mux = new Multiplexer(this.transport)

    if (this.options.timeout) {
      this.mux.setTimeout(this.options.timeout)
    }

    this.session = await handshake(this.mux, this.url, {
      username: this.options.credentials?.username,
    })
  }

  async open(path: string, options?: { flags?: number; mode?: number }): Promise<File> {
    if (!this.mux || !this.session) {
      throw new XRootDError(311, 'Client not connected')
    }

    const file = new File(this.mux, this.session)
    await file.open(path, options)
    return file
  }

  async stat(path: string): Promise<StatInfo> {
    if (!this.mux || !this.session) {
      throw new XRootDError(311, 'Client not connected')
    }

    const file = new File(this.mux, this.session)
    await file.open(path, { flags: 0x0010 })
    try {
      return await file.stat()
    } finally {
      await file.close()
    }
  }

  async close(): Promise<void> {
    if (this.mux) {
      this.mux.close()
      this.mux = null
    }

    if (this.transport) {
      await this.transport.close()
      this.transport = null
    }

    this.session = null
  }

  get isConnected(): boolean {
    return this.session !== null
  }

  get location(): string {
    return this.url.getLocation()
  }
}
