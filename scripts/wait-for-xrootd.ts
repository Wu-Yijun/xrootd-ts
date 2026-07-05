#!/usr/bin/env node

/**
 * Wait for XRootD mock server to be fully ready.
 *
 * Unlike a simple TCP check, this script performs an actual XRootD handshake
 * to verify the daemon is ready to handle protocol-level requests.
 *
 * The Docker healthcheck only tests TCP connectivity (echo > /dev/tcp/...),
 * which passes before the xrootd daemon finishes internal initialization.
 * This script bridges that gap by retrying until a real handshake succeeds.
 */

import { Transport } from "../src/transport/transport.ts";
import { Multiplexer } from "../src/transport/multiplexer.ts";
import { handshake } from "../src/session/handshake.ts";
import { XRootDUrl } from "../src/url/url.ts";

const HOST = process.env.XROOTD_HOST || "localhost";
const PORT = parseInt(process.env.XROOTD_PORT || "1094", 10);
const MAX_RETRIES = 30;
const RETRY_INTERVAL_MS = 1000;

async function tryHandshake(): Promise<boolean> {
  const transport = new Transport();
  try {
    await transport.connect(HOST, PORT);
    const mux = new Multiplexer(transport);
    try {
      const url = new XRootDUrl(`root://${HOST}:${PORT}/`);
      await handshake(mux, url);
      return true;
    } finally {
      mux.close();
    }
  } catch {
    return false;
  } finally {
    await transport.close();
  }
}

async function main() {
  console.log(`Waiting for XRootD server at ${HOST}:${PORT}...`);

  for (let i = 1; i <= MAX_RETRIES; i++) {
    const ok = await tryHandshake();
    if (ok) {
      console.log(`XRootD server is ready (attempt ${i}/${MAX_RETRIES})`);
      return;
    }
    console.log(
      `  attempt ${i}/${MAX_RETRIES} failed, retrying in ${RETRY_INTERVAL_MS}ms...`,
    );
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
  }

  console.error(
    `XRootD server did not become ready after ${MAX_RETRIES} attempts`,
  );
  process.exit(1);
}

main();
