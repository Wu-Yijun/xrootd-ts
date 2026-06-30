export interface ITransport {
  connect(host: string, port: number, useTls?: boolean): Promise<void>
  send(data: Buffer): Promise<void>
  onData(callback: (chunk: Buffer) => void): void
  close(): Promise<void>
  destroy(): void
}
