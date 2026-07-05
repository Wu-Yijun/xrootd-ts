import { Multiplexer } from '../transport/multiplexer.ts'
import { XRootDUrl } from '../url/url.ts'
import {
  PROTOCOL_VERSION,
  kXR_secreqs,
  kXR_bifreqs,
  kXR_ExpLogin,
  ResponseStatus,
} from '../protocol/constants.ts'
import {
  buildHandshakeAndProtocol,
  buildLoginRequest,
  parseProtocolResponse,
  parseLoginResponse,
  parseRedirectResponse,
  parseErrorResponse,
} from '../protocol/message.ts'
import { Framer, type Frame } from '../transport/framer.ts'
import type { ITransport } from '../transport/interface.ts'

export interface Session {
  sessid: Uint8Array
  protocolVersion: number
  secReqs?: string
  bifReqs?: string
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
    username?: string
    pid?: number
  },
): Promise<Session> {
  const username = options?.username ?? ''
  const pid = options?.pid ?? process.pid
  const flags = kXR_secreqs | kXR_bifreqs

  const handshakeBuf = buildHandshakeAndProtocol(0, flags, kXR_ExpLogin)

  const transport = (mux as unknown as { transport: ITransport }).transport
  await transport.send(handshakeBuf)

  // Use a single Framer for all handshake reads (handshake response + protocol response)
  const framer = new Framer()

  const handshakeFrame = await waitForFrame(transport, framer)
  // handshakeFrame contains: streamId=0, status=0, dlen=8, body=8B (protover + msgval)
  // We don't need to parse it further; just consume it.

  const protoFrame = await waitForFrame(transport, framer)

  if (protoFrame.status === ResponseStatus.Error) {
    const err = parseErrorResponse(protoFrame.body)
    throw new Error(`Protocol handshake error: ${err.errmsg} (${err.errnum})`)
  }

  if (protoFrame.status !== ResponseStatus.Ok) {
    throw new Error(`Unexpected protocol response status: ${protoFrame.status}`)
  }

  const protoResp = parseProtocolResponse(protoFrame.body)

  const loginBuf = buildLoginRequest(0, pid, username)
  await transport.send(loginBuf)

  const loginFrame = await waitForFrame(transport, framer)

  if (loginFrame.status === ResponseStatus.Error) {
    const err = parseErrorResponse(loginFrame.body)
    throw new Error(`Login error: ${err.errmsg} (${err.errnum})`)
  }

  if (loginFrame.status === ResponseStatus.Redirect) {
    const redir = parseRedirectResponse(loginFrame.body)
    throw new Error(`Login redirect to ${redir.host}:${redir.port}`)
  }

  if (loginFrame.status !== ResponseStatus.Ok) {
    throw new Error(`Unexpected login response status: ${loginFrame.status}`)
  }

  const loginResp = parseLoginResponse(loginFrame.body)

  return {
    sessid: loginResp.sessid,
    protocolVersion: protoResp.pval,
    secReqs: protoResp.secReqs,
    bifReqs: protoResp.bifReqs,
  }
}

/**
 * Wait for the next complete frame from the transport using the provided Framer.
 * This function registers an onData handler and resolves when a complete frame
 * is parsed. The handler is removed after the first frame is received.
 */
function waitForFrame(transport: ITransport, framer: Framer): Promise<Frame> {
  return new Promise<Frame>((resolve) => {
    const handler = (chunk: Buffer) => {
      const frames = framer.feed(chunk)
      for (const frame of frames) {
        transport.removeDataHandler(handler)
        resolve(frame)
        return
      }
    }
    transport.onData(handler)
  })
}
