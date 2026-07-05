import net from "node:net";

export type SliceMode = "1byte" | "random" | "none";

export interface ChaosOptions {
  sliceMode?: SliceMode;
  delay?: number;
}

export class TcpChaosServer {
  private server: net.Server | null = null;
  private clients: net.Socket[] = [];
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        this.clients.push(socket);
        socket.on("close", () => {
          this.clients = this.clients.filter((c) => c !== socket);
        });
      });
      this.server.listen(this.port, resolve);
    });
  }

  get clientCount(): number {
    return this.clients.length;
  }

  broadcast(data: Buffer, options?: ChaosOptions): void {
    for (const client of this.clients) {
      this.sendTo(client, data, options);
    }
  }

  send(data: Buffer, options?: ChaosOptions): void {
    const client = this.clients[0];
    if (client) {
      this.sendTo(client, data, options);
    }
  }

  private sendTo(
    socket: net.Socket,
    data: Buffer,
    options?: ChaosOptions,
  ): void {
    const mode = options?.sliceMode ?? "none";
    const delay = options?.delay ?? 0;

    if (mode === "none") {
      socket.write(data);
      return;
    }

    const chunks = this.slice(data, mode);
    let i = 0;
    const writeNext = () => {
      if (i >= chunks.length) return;
      const chunk = chunks[i++];
      socket.write(chunk, () => {
        if (delay > 0 && i < chunks.length) {
          setTimeout(writeNext, delay);
        } else {
          writeNext();
        }
      });
    };
    writeNext();
  }

  private slice(data: Buffer, mode: SliceMode): Buffer[] {
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < data.length) {
      let len: number;
      if (mode === "1byte") {
        len = 1;
      } else {
        len = Math.min(Math.ceil(Math.random() * 10), data.length - offset);
      }
      chunks.push(data.subarray(offset, offset + len));
      offset += len;
    }

    return chunks;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        client.destroy();
      }
      this.clients = [];
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
