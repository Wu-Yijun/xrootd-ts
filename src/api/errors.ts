const codeMessages: Record<number, string> = {
  3000: 'Invalid argument',
  3001: 'Missing argument',
  3002: 'Argument too long',
  3003: 'File locked',
  3004: 'File not open',
  3005: 'File system error',
  3006: 'Invalid request',
  3007: 'I/O error',
  3008: 'No memory',
  3009: 'No space',
  3010: 'Not authorized',
  3011: 'File not found',
  3012: 'Server error',
  3013: 'Unsupported',
  3014: 'No server',
  3015: 'Not a file',
  3016: 'Is a directory',
  3017: 'Operation cancelled',
  3018: 'File already exists',
  3019: 'Checksum error',
  3020: 'Operation in progress',
  3021: 'Over quota',
  3022: 'Signature verification error',
  3023: 'Decryption error',
  3024: 'Server overloaded',
  3025: 'File system read-only',
  3026: 'Bad payload',
  3027: 'Attribute not found',
  3028: 'TLS required',
  3029: 'No replicas',
  3030: 'Authentication failed',
  3031: 'Impossible',
  3032: 'Conflict',
  3033: 'Too many errors',
  3034: 'Request timed out',
  3035: 'Timer expired',
}

export class XRootDError extends Error {
  readonly code: number
  readonly errno?: number

  constructor(code: number, message?: string, errno?: number) {
    super(message ?? XRootDError.codeToMessage(code))
    this.name = 'XRootDError'
    this.code = code
    this.errno = errno
  }

  static codeToMessage(code: number): string {
    return codeMessages[code] ?? `Unknown error (${code})`
  }
}
