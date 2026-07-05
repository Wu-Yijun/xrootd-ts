/**
 * Message builder for constructing binary protocol messages.
 * Tracks offset automatically during writes.
 */
export class Message {
  private buffer: Buffer;
  private offset = 0;

  constructor(size: number) {
    this.buffer = Buffer.alloc(size);
  }

  writeInt32BE(value: number): void {
    this.buffer.writeInt32BE(value, this.offset);
    this.offset += 4;
  }

  writeInt16BE(value: number): void {
    this.buffer.writeInt16BE(value, this.offset);
    this.offset += 2;
  }

  writeUInt8(value: number): void {
    this.buffer.writeUInt8(value, this.offset);
    this.offset += 1;
  }

  writeBytes(data: Uint8Array): void {
    Buffer.from(data).copy(this.buffer, this.offset);
    this.offset += data.length;
  }

  readInt32BE(): number {
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  readInt16BE(): number {
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  readBytes(length: number): Buffer {
    const data = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}
