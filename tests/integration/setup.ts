import { createConnection } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { handshake } from "../../src/session/handshake.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { File } from "../../src/api/file.ts";
import { FileSystem } from "../../src/api/filesystem.ts";
import type { Session } from "../../src/session/handshake.ts";

export const XROOTD_HOST = process.env.XROOTD_HOST || "localhost";
export const XROOTD_PORT = parseInt(process.env.XROOTD_PORT || "1094", 10);
export const SERVER_URL = `root://${XROOTD_HOST}:${XROOTD_PORT}/`;

export const TEST_FILE_PATH = "/data/test/testfile.txt";
export const EXPECTED_FILE_CONTENTS = "Hello, XRootD!\n" +
  "This is a test file for the mock server.\n" +
  "Line 3: Testing basic file operations.\n" +
  "Line 4: Reading offset and size should work.\n" +
  "Line 5: End of test file.\n";

export const TEST_WRITE_DIR = "/data/test/integration";

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export function checkServerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(
      { host: XROOTD_HOST, port: XROOTD_PORT },
      () => {
        socket.end();
        resolve(true);
      },
    );
    socket.on("error", () => resolve(false));
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function skipIfServerUnavailable(
  this: TestContext,
): Promise<void> {
  const available = await checkServerAvailable();
  if (!available) {
    console.log(
      `  ⏭ Skipping: xrootd mock server not available at ${XROOTD_HOST}:${XROOTD_PORT}`,
    );
    console.log(`     Start it with: pnpm mock-server:up`);
    this.skip();
  }
}

// ── Shared connection helpers ──────────────────────────────────────────────

export interface ConnectedLowLevel {
  transport: Transport;
  mux: Multiplexer;
  session: Session;
}

export async function createConnectedLowLevel(): Promise<ConnectedLowLevel> {
  const transport = new Transport();
  await transport.connect(XROOTD_HOST, XROOTD_PORT);
  const mux = new Multiplexer(transport);
  const url = new XRootDUrl(SERVER_URL);
  const session = await withTimeout(
    handshake(mux, url),
    5000,
    "handshake with xrootd server",
  );
  return { transport, mux, session };
}

export async function closeLowLevel(conn: ConnectedLowLevel): Promise<void> {
  conn.mux.close();
  await conn.transport.close();
}

export async function createConnectedClient() {
  const { default: { XRootDClient } } = await import("../../src/client.ts");
  const client = new XRootDClient(SERVER_URL);
  await withTimeout(client.connect(), 5000, "client.connect()");
  return client;
}

// ── Test file helpers ──────────────────────────────────────────────────────

let testDirCreated = false;

export async function ensureTestWriteDir(): Promise<void> {
  if (testDirCreated) return;
  const { transport, mux, session } = await createConnectedLowLevel();
  try {
    const fs = new FileSystem(mux);
    try {
      await fs.mkdir(TEST_WRITE_DIR);
    } catch {
      // already exists
    }
    testDirCreated = true;
  } finally {
    await closeLowLevel({ transport, mux, session });
  }
}

export function randomTestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function testFilePath(name: string): string {
  return `${TEST_WRITE_DIR}/${name}`;
}
