import { Multiplexer } from "../transport/multiplexer.ts";
import { XRootDUrl } from "../url/url.ts";
import {
  BifReqs,
  ClientError,
  ExpLogin,
  PROTOCOL_VERSION,
  ResponseStatus,
  SecReqs,
} from "../protocol/constants.ts";
import {
  buildHandshakeAndProtocol,
  buildLoginRequest,
  parseErrorResponse,
  parseLoginResponse,
  parseProtocolResponse,
  parseRedirectResponse,
  parseSecToken,
  parseSpnPrefix,
} from "../protocol/message.ts";
import { createFrameReader } from "../utils/frame-reader.ts";
import { XRootDError } from "../api/errors.ts";
import type { SecEntity } from "../security/interface.ts";

export interface Session {
  sessid: Uint8Array;
  protocolVersion: number;
  /** Security level from protocol response secReqs struct. */
  seclvl?: number;
  /** Bind preferences from protocol response bifReqs struct. */
  bifReqs?: string;
  secEntity?: SecEntity;
  /** Auth protocol names parsed from login response secToken. */
  authProtocols?: string[];
  /** Whether the server sent a secToken in login response (auth required). */
  needsAuth: boolean;
  /** Kerberos SPN prefix parsed from secToken (e.g. "xrootd" or "host"). */
  spnPrefix?: string;
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
  const flags = SecReqs | BifReqs;

  const handshakeBuf = buildHandshakeAndProtocol(0, flags, ExpLogin);

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
      throw new XRootDError(
        ClientError.InternalError,
        `Protocol handshake error: ${err.errmsg} (${err.errnum})`,
      );
    }

    if (protoFrame.status !== ResponseStatus.Ok) {
      throw new XRootDError(
        ClientError.InternalError,
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
      throw new XRootDError(
        ClientError.InternalError,
        `Login error: ${err.errmsg} (${err.errnum})`,
      );
    }

    if (loginFrame.status === ResponseStatus.Redirect) {
      const redir = parseRedirectResponse(loginFrame.body);
      throw new XRootDError(
        ClientError.Redirect,
        `Login redirect to ${redir.host}:${redir.port}`,
      );
    }

    if (loginFrame.status !== ResponseStatus.Ok) {
      throw new XRootDError(
        ClientError.InternalError,
        `Unexpected login response status: ${loginFrame.status}`,
      );
    }

    const loginResp = parseLoginResponse(loginFrame.body);

    // Parse SPN prefix from secToken (e.g. "xrootd" from "&P=krb5,xrootd/eos01...")
    let spnPrefix: string | undefined;
    if (loginResp.secToken) {
      spnPrefix = parseSpnPrefix(loginResp.secToken, "krb5");
    }

    return {
      sessid: loginResp.sessid,
      protocolVersion: protoResp.pval,
      seclvl: protoResp.seclvl,
      bifReqs: protoResp.bifReqs,
      authProtocols: loginResp.secToken
        ? parseSecToken(loginResp.secToken)
        : undefined,
      needsAuth: loginResp.needsAuth,
      spnPrefix,
    };
  } finally {
    reader.close();
  }
}
