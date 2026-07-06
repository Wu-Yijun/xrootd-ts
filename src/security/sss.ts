import { createCipheriv } from "node:crypto";
import type { AuthParams, SecEntity, SecurityProtocol } from "./interface.ts";
import { crc32 } from "../utils/crc32.ts";
import { pkcs5Pad } from "../utils/crypto.ts";

/**
 * SSS (Simple Shared Secret) authentication protocol.
 *
 * Uses Blowfish-ECB encryption + CRC32 checksum.
 * Note: Requires Node.js with legacy OpenSSL provider for Blowfish support.
 * Run with: NODE_OPTIONS=--openssl-legacy-provider
 *
 * Or use the static create() method which checks if Blowfish is available.
 */
export class SSSAuth implements SecurityProtocol {
  readonly name = "sss";
  private entity: SecEntity = { prot: "sss", uid: 0, gid: 0 };
  private complete = false;
  private key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 8) {
      throw new Error("SSS key must be 8 bytes");
    }
    this.key = key;
  }

  static isSupported(): boolean {
    try {
      const cipher = createCipheriv("bf-ecb", Buffer.alloc(8), null);
      cipher.final();
      return true;
    } catch {
      return false;
    }
  }

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    const password = params.password || "";
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);

    const crc = crc32(passwordBytes);

    const payload = Buffer.alloc(passwordBytes.length + 4);
    Buffer.from(passwordBytes).copy(payload, 0);
    payload.writeUInt32BE(crc, passwordBytes.length);

    const cipher = createCipheriv("bf-ecb", this.key, null);
    const padded = pkcs5Pad(payload, 8);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    this.entity.name = params.username;
    return new Uint8Array(encrypted);
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    this.complete = true;
    return new Uint8Array(0);
  }

  isComplete(): boolean {
    return this.complete;
  }

  getEntity(): SecEntity {
    return this.entity;
  }
}
