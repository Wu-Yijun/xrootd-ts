const DEFAULT_PORT = 1094

export class XRootDUrl {
  protocol: string
  user?: string
  password?: string
  host: string
  port: number
  path: string

  constructor(url: string) {
    const parsed = XRootDUrl.parseInternal(url)
    this.protocol = parsed.protocol
    this.user = parsed.user
    this.password = parsed.password
    this.host = parsed.host
    this.port = parsed.port
    this.path = parsed.path
  }

  static parse(url: string): XRootDUrl {
    return new XRootDUrl(url)
  }

  toString(): string {
    let auth = ''
    if (this.user) {
      auth = this.user
      if (this.password) {
        auth += ':' + this.password
      }
      auth += '@'
    }

    const portStr = this.port === DEFAULT_PORT ? '' : `:${this.port}`
    return `${this.protocol}://${auth}${this.host}${portStr}${this.path}`
  }

  isValid(): boolean {
    return this.protocol === 'root' || this.protocol === 'roots'
  }

  isSecure(): boolean {
    return this.protocol === 'roots'
  }

  getHostId(): string {
    let auth = ''
    if (this.user) {
      auth = this.user
      if (this.password) {
        auth += ':' + this.password
      }
      auth += '@'
    }
    return `${auth}${this.host}:${this.port}`
  }

  getChannelId(): string {
    return `${this.host}:${this.port}`
  }

  getLocation(): string {
    return `${this.protocol}://${this.host}:${this.port}${this.path}`
  }

  private static parseInternal(url: string): {
    protocol: string
    user?: string
    password?: string
    host: string
    port: number
    path: string
  } {
    const match = url.match(
      /^(roots?):\/\/(?:(?:([^:]+)(?::([^@]*))?)@)?([^:/]+)(?::(\d+))?)?(\/.*)?$/,
    )
    if (!match) {
      throw new Error(`Invalid XRootD URL: ${url}`)
    }

    const protocol = match[1]
    const user = match[2] || undefined
    const password = match[3] || undefined
    const host = match[4]
    const port = match[5] ? parseInt(match[5], 10) : DEFAULT_PORT
    const path = match[6] || '/'

    if (!host) {
      throw new Error(`Invalid XRootD URL: missing host in "${url}"`)
    }

    return { protocol, user, password, host, port, path }
  }
}
