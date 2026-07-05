import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../../src/transport/transport.ts";
import { Multiplexer } from "../../src/transport/multiplexer.ts";
import { handshake } from "../../src/session/handshake.ts";
import { XRootDUrl } from "../../src/url/url.ts";
import { File } from "../../src/api/file.ts";
import { XRootDError } from "../../src/api/errors.ts";
import {
  skipIfServerUnavailable,
  TEST_FILE_PATH,
  XROOTD_HOST,
  XROOTD_PORT,
} from "./setup.ts";

function withTimeout<T>(
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

async function createConnectedClient(): Promise<{
  transport: Transport;
  mux: Multiplexer;
  session: Awaited<ReturnType<typeof handshake>>;
  close: () => Promise<void>;
}> {
  const transport = new Transport();
  await transport.connect(XROOTD_HOST, XROOTD_PORT);
  const mux = new Multiplexer(transport);
  const url = new XRootDUrl(`root://${XROOTD_HOST}:${XROOTD_PORT}/`);
  const session = await withTimeout(
    handshake(mux, url),
    5000,
    "handshake with xrootd server",
  );
  return {
    transport,
    mux,
    session,
    close: async () => {
      mux.close();
      await transport.close();
    },
  };
}

describe("Integration: File.sync", () => {
  before(skipIfServerUnavailable);

  it("sync on opened file does not throw", async () => {
    const { mux, session, close } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      try {
        await file.sync();
      } catch (err) {
        if (err instanceof XRootDError) {
          assert.ok(
            err.code === 3010 || err.code === 3011,
            `sync error code should be 3010 (NotAuthorized) or 3011 (NotFound), got ${err.code}: ${err.message}`,
          );
        } else {
          throw err;
        }
      }

      await file.close();
    } finally {
      await close();
    }
  });

  it("sync on closed file throws XRootDError", async () => {
    const { mux, session, close } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      try {
        await file.sync();
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await close();
    }
  });
});

describe("Integration: File.truncate", () => {
  before(skipIfServerUnavailable);

  it("truncate on opened file does not throw", async () => {
    const { mux, session, close } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      await file.open(TEST_FILE_PATH);

      try {
        await file.truncate(0);
      } catch (err) {
        if (err instanceof XRootDError) {
          assert.ok(
            err.code === 3010 || err.code === 3011,
            `truncate error code should be 3010 (NotAuthorized) or 3011 (NotFound), got ${err.code}: ${err.message}`,
          );
        } else {
          throw err;
        }
      }

      await file.close();
    } finally {
      await close();
    }
  });

  it("truncate on closed file throws XRootDError", async () => {
    const { mux, session, close } = await createConnectedClient();
    try {
      const file = new File(mux, session);
      try {
        await file.truncate(0);
        assert.fail("Expected error");
      } catch (err) {
        assert.ok(err instanceof XRootDError);
        assert.equal(err.code, 3004);
      }
    } finally {
      await close();
    }
  });
});
