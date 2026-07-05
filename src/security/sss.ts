import { createCipheriv } from 'node:crypto'
import type { SecurityProtocol, AuthParams, SecEntity } from './interface.ts'

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pkcs5Pad(data: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (data.length % blockSize)
  const padded = Buffer.alloc(data.length + padLen)
  data.copy(padded)
  padded.fill(padLen, data.length)
  return padded
}

export class SSSAuth implements SecurityProtocol {
  readonly name = 'sss'
  private entity: SecEntity = { prot: 'sss', uid: 0, gid: 0 }
  private complete = false
  private key: Buffer

  constructor(key: Buffer) {
    if (key.length !== 8) {
      throw new Error('SSS key must be 8 bytes')
    }
    this.key = key
  }

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    const password = params.password || ''
    const encoder = new TextEncoder()
    const passwordBytes = encoder.encode(password)

    const crc = crc32(passwordBytes)

    const payload = Buffer.alloc(passwordBytes.length + 4)
    Buffer.from(passwordBytes).copy(payload, 0)
    payload.writeUInt32BE(crc, passwordBytes.length)

    const cipher = createCipheriv('bf-ecb', this.key, null)
    const padded = pkcs5Pad(payload, 8)
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])

    this.entity.name = params.username
    return new Uint8Array(encrypted)
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    this.complete = true
    return new Uint8Array(0)
  }

  isComplete(): boolean {
    return this.complete
  }

  getEntity(): SecEntity {
    return this.entity
  }
}
