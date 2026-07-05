import { createConnection } from 'node:net'
import type { TestContext } from 'node:test'

export const XROOTD_HOST = process.env.XROOTD_HOST || 'localhost'
export const XROOTD_PORT = parseInt(process.env.XROOTD_PORT || '1094', 10)

export const TEST_FILE_PATH = '/data/test/testfile.txt'
export const EXPECTED_FILE_CONTENTS =
  'Hello, XRootD!\n' +
  'This is a test file for the mock server.\n' +
  'Line 3: Testing basic file operations.\n' +
  'Line 4: Reading offset and size should work.\n' +
  'Line 5: End of test file.\n'

export function checkServerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: XROOTD_HOST, port: XROOTD_PORT }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(3000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

export async function skipIfServerUnavailable(this: TestContext): Promise<void> {
  const available = await checkServerAvailable()
  if (!available) {
    console.log(`  ⏭ Skipping: xrootd mock server not available at ${XROOTD_HOST}:${XROOTD_PORT}`)
    console.log(`     Start it with: pnpm mock-server:up`)
    this.skip()
  }
}
