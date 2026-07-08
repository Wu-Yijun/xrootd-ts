import net from "node:net";
import tls from "node:tls";
import type { ITransport } from "./interface.ts";
import { ClientError } from "../protocol/constants.ts";
import { XRootDError } from "../api/errors.ts";

const DEBUG = () => process?.env?.DEBUG === "true";

function DEBUG_to_ascii(buf: Buffer): string {
  const p = buf.map((byte) => {
    // Check if byte is a printable ASCII character (32 = space, 126 = ~)
    if (byte >= 32 && byte <= 126) {
      return byte; // Keep the byte
    }
    // Replace unprintable bytes (like control characters or hex) with '.' (ASCII 46)
    return 46;
  });
  return p.toString();
}

export interface TransportOptions {
  /** Whether to call socket.unref() so the connection doesn't keep the process alive. @default false */
  unrefSockets?: boolean;
  /**
   * Idle timeout in milliseconds. Socket is destroyed after this period of no data flow.
   * Uses Node.js native socket.setTimeout() which auto-resets on data activity.
   * Set to 0 to disable (not recommended). @default 30000
   */
  idleTimeout?: number;
}

export class Transport implements ITransport {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private closeCallback: (() => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;
  private dataHandlers: ((chunk: Buffer) => void)[] = [];
  private dataListenerInstalled = false;
  private host: string = "";
  private port: number = 0;
  private options: TransportOptions;

  constructor(options?: TransportOptions) {
    this.options = options ?? {};
  }

  async connect(
    host: string,
    port: number,
    useTls = false,
    tlsOptions?: { rejectUnauthorized?: boolean },
  ): Promise<void> {
    this.host = host;
    this.port = port;
    this.socket = useTls
      ? await this.tlsConnect(host, port, tlsOptions)
      : await this.tcpConnect(host, port);

    if (this.options.unrefSockets) {
      this.socket.unref();
    }

    const timeoutMs = this.options.idleTimeout ?? 30_000;
    if (timeoutMs > 0) {
      this.socket.setTimeout(timeoutMs);
      this.socket.on("timeout", () => {
        const err = new XRootDError(
          ClientError.Timeout,
          `Connection idle for ${timeoutMs}ms on ${this.host}:${this.port}. ` +
            `Socket destroyed to prevent resource leak. ` +
            `If processing multiple files, open them just-in-time or set idleTimeout: 0 on this file.`,
        );
        this.destroy();
        this.closeCallback?.();
        this.errorCallback?.(err);
      });
    }

    this.socket.on("close", () => {
      this.closeCallback?.();
    });

    this.socket.on("error", (err: Error) => {
      this.errorCallback?.(err);
    });

    this.socket.on("data", (chunk: Buffer) => {
      if (DEBUG()) {
        console.log(
          `Transport.onData: received ${chunk.length} bytes: `,
          chunk,
        );
      }
      if (DEBUG()) console.log(`  Received Ascii: `, DEBUG_to_ascii(chunk));
      for (const handler of this.dataHandlers) {
        handler(chunk);
      }
    });
    this.dataListenerInstalled = true;
  }

  send(data: Buffer): Promise<void> {
    if (DEBUG()) {
      console.log(`Transport.send: sending ${data.length} bytes: `, data);
    }
    if (DEBUG()) console.log(`  Send Ascii: `, DEBUG_to_ascii(data));
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
    this.socket?.removeAllListeners("timeout");
    this.socket?.destroy();
    this.socket = null;
  }

  private tcpConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => resolve(socket));
      socket.once("error", reject);
    });
  }

  private tlsConnect(
    host: string,
    port: number,
    tlsOptions?: { rejectUnauthorized?: boolean },
  ): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host,
          port,
          rejectUnauthorized: tlsOptions?.rejectUnauthorized ?? false,
        },
        () => resolve(socket),
      );
      socket.once("error", reject);
    });
  }
}
