import { Multiplexer } from "../transport/multiplexer.ts";
import { XRootDUrl } from "../url/url.ts";
import {
  kXR_bifreqs,
  kXR_ExpLogin,
  kXR_secreqs,
  PROTOCOL_VERSION,
  ResponseStatus,
} from "../protocol/constants.ts";
import {
  buildHandshakeAndProtocol,
  buildLoginRequest,
  parseErrorResponse,
  parseLoginResponse,
  parseProtocolResponse,
  parseRedirectResponse,
} from "../protocol/message.ts";
import { type Frame, Framer } from "../transport/framer.ts";
import type { ITransport } from "../transport/interface.ts";

export interface Session {
  sessid: Uint8Array;
  protocolVersion: number;
  secReqs?: string;
  bifReqs?: string;
}

/**
 * Perform XRootD connection handshake:
 * 1. Send ClientInitHandShake(20B) + kXR_protocol(24B) merged = 44 bytes
 * 2. Receive handshake response frame (16B: ServerResponseHeader 8B with
 *    dlen/msglen shared with ServerInitHandShake)
 * 3. Receive kXR_ok + Protocol Response
 * 4. Send kXR_login request
 * 5. Receive kXR_ok + Login Response (sessid[16] + optional secToken)
 * 6. [Optional] kXR_auth multi-round authentication
 */
export async function handshake(
  mux: Multiplexer,
  url: XRootDUrl,
  options?: {
    username?: string;
    pid?: number;
  },
): Promise<Session> {
  const username = options?.username ?? "";
  const pid = options?.pid ?? process.pid;
  const flags = kXR_secreqs | kXR_bifreqs;

  const handshakeBuf = buildHandshakeAndProtocol(0, flags, kXR_ExpLogin);

  const transport = mux.getTransport();

  // Register the frame reader BEFORE sending to avoid a race condition:
  // the server may respond before waitForFrame() would register its handler,
  // and the Multiplexer's onData handler (already registered) would consume
  // and drop the frames.
  const reader = createFrameReader(transport);

  try {
    await transport.send(handshakeBuf);

    // First frame: ServerInitHandShake (streamId=0, status=0, dlen=8)
    await reader.nextFrame();

    // Second frame: kXR_ok + Protocol Response
    const protoFrame = await reader.nextFrame();

    if (protoFrame.status === ResponseStatus.Error) {
      const err = parseErrorResponse(protoFrame.body);
      throw new Error(
        `Protocol handshake error: ${err.errmsg} (${err.errnum})`,
      );
    }

    if (protoFrame.status !== ResponseStatus.Ok) {
      throw new Error(
        `Unexpected protocol response status: ${protoFrame.status}`,
      );
    }

    const protoResp = parseProtocolResponse(protoFrame.body);

    const loginBuf = buildLoginRequest(0, pid, username);
    await transport.send(loginBuf);

    // Third frame: kXR_ok + Login Response
    const loginFrame = await reader.nextFrame();

    if (loginFrame.status === ResponseStatus.Error) {
      const err = parseErrorResponse(loginFrame.body);
      throw new Error(`Login error: ${err.errmsg} (${err.errnum})`);
    }

    if (loginFrame.status === ResponseStatus.Redirect) {
      const redir = parseRedirectResponse(loginFrame.body);
      throw new Error(`Login redirect to ${redir.host}:${redir.port}`);
    }

    if (loginFrame.status !== ResponseStatus.Ok) {
      throw new Error(`Unexpected login response status: ${loginFrame.status}`);
    }

    const loginResp = parseLoginResponse(loginFrame.body);

    return {
      sessid: loginResp.sessid,
      protocolVersion: protoResp.pval,
      secReqs: protoResp.secReqs,
      bifReqs: protoResp.bifReqs,
    };
  } finally {
    reader.close();
  }
}

/**
 * Creates a persistent frame reader that registers ONE onData handler
 * before any data is sent, avoiding the race condition where the
 * Multiplexer's handler consumes frames before the handshake can read them.
 *
 * Uses a queue pattern: incoming frames are queued, and nextFrame()
 * resolves the next available frame (or waits for one to arrive).
 */
function createFrameReader(transport: ITransport) {
  const framer = new Framer();
  const frameQueue: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];

  const handler = (chunk: Buffer) => {
    const frames = framer.feed(chunk);
    for (const frame of frames) {
      if (waiters.length > 0) {
        waiters.shift()!(frame);
      } else {
        frameQueue.push(frame);
      }
    }
  };

  transport.onData(handler);

  return {
    nextFrame(): Promise<Frame> {
      if (frameQueue.length > 0) {
        return Promise.resolve(frameQueue.shift()!);
      }
      return new Promise<Frame>((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      transport.removeDataHandler(handler);
    },
  };
}
