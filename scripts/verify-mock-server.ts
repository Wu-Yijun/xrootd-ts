#!/usr/bin/env node

/**
 * XRootD Mock Server 验证脚本
 * 验证 mock server 是否正常运行并支持基本操作
 */

import { createConnection } from "node:net";

const HOST = process.env.XROOTD_HOST || "localhost";
const PORT = parseInt(process.env.XROOTD_PORT || "1094", 10);

console.log(`Testing XRootD Mock Server at ${HOST}:${PORT}`);

function testTCPConnection(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port: PORT }, () => {
      console.log("✓ TCP connection established");
      socket.end();
      resolve(true);
    });

    socket.on("error", (err) => {
      console.error("✗ TCP connection failed:", err.message);
      resolve(false);
    });

    socket.setTimeout(5000, () => {
      console.error("✗ TCP connection timeout");
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log("\n=== XRootD Mock Server Verification ===\n");

  const tcpOk = await testTCPConnection();

  if (tcpOk) {
    console.log("\n✓ Mock Server is ready for testing");
    console.log(`  Server: ${HOST}:${PORT}`);
    console.log("\nNext steps:");
    console.log("  1. Run integration tests");
    console.log("  2. Test protocol implementation");
  } else {
    console.log("\n✗ Mock Server is not available");
    console.log("\nTroubleshooting:");
    console.log("  1. Run: docker compose up -d");
    console.log("  2. Check: docker compose logs xrootd-mock");
    process.exit(1);
  }
}

main().catch(console.error);
