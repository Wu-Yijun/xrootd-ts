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
    const protoMatch = url.match(/^(roots?):\/\//)
    if (!protoMatch) {
      throw new Error(`Invalid XRootD URL: ${url}`)
    }

    const protocol = protoMatch[1]
    const rest = url.slice(protoMatch[0].length)

    let auth: string | undefined
    let hostPort: string
    let path = '/'

    const atIdx = rest.indexOf('@')
    if (atIdx !== -1) {
      auth = rest.slice(0, atIdx)
      rest.slice(atIdx + 1)
      hostPort = rest.slice(atIdx + 1)
    } else {
      hostPort = rest
    }

    const slashIdx = hostPort.indexOf('/')
    if (slashIdx !== -1) {
      path = hostPort.slice(slashIdx)
      hostPort = hostPort.slice(0, slashIdx)
    }

    let user: string | undefined
    let password: string | undefined
    if (auth) {
      const colonIdx = auth.indexOf(':')
      if (colonIdx !== -1) {
        user = auth.slice(0, colonIdx)
        password = auth.slice(colonIdx + 1)
      } else {
        user = auth
      }
    }

    const colonIdx = hostPort.lastIndexOf(':')
    let host: string
    let port = DEFAULT_PORT
    if (colonIdx !== -1) {
      host = hostPort.slice(0, colonIdx)
      const portStr = hostPort.slice(colonIdx + 1)
      port = portStr ? parseInt(portStr, 10) : DEFAULT_PORT
    } else {
      host = hostPort
    }

    if (!host) {
      throw new Error(`Invalid XRootD URL: missing host in "${url}"`)
    }

    return { protocol, user, password, host, port, path }
  }
}
