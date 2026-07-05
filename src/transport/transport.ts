import net from "node:net";
import tls from "node:tls";
import type { ITransport } from "./interface.ts";

export class Transport implements ITransport {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private closeCallback: (() => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;
  private dataHandlers: ((chunk: Buffer) => void)[] = [];
  private dataListenerInstalled = false;

  async connect(host: string, port: number, useTls = false): Promise<void> {
    this.socket = useTls
      ? await this.tlsConnect(host, port)
      : await this.tcpConnect(host, port);

    this.socket.on("close", () => {
      this.closeCallback?.();
    });

    this.socket.on("error", (err: Error) => {
      this.errorCallback?.(err);
    });

    this.socket.on("data", (chunk: Buffer) => {
      for (const handler of this.dataHandlers) {
        handler(chunk);
      }
    });
    this.dataListenerInstalled = true;
  }

  send(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket!.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(callback: (chunk: Buffer) => void): void {
    this.dataHandlers.push(callback);
  }

  removeDataHandler(callback: (chunk: Buffer) => void): void {
    const idx = this.dataHandlers.indexOf(callback);
    if (idx >= 0) {
      this.dataHandlers.splice(idx, 1);
    }
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  async close(): Promise<void> {
    this.destroy();
  }

  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  private tcpConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => resolve(socket));
      socket.once("error", reject);
    });
  }

  private tlsConnect(host: string, port: number): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host, port, rejectUnauthorized: false },
        () => resolve(socket),
      );
      socket.once("error", reject);
    });
  }
}
