/**
 * Cryptographic padding utilities.
 */

/**
 * PKCS#5 / PKCS#7 padding for block ciphers.
 * Pads `data` to a multiple of `blockSize` bytes.
 */
export function pkcs5Pad(data: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (data.length % blockSize);
  const padded = Buffer.alloc(data.length + padLen);
  data.copy(padded);
  padded.fill(padLen, data.length);
  return padded;
}
