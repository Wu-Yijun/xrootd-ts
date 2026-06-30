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
import type { Frame } from '../transport/framer.ts'

export interface Session {
  sessid: Uint8Array
  protocolVersion: number
  secReqs?: string
  bifReqs?: string
}

/**
 * Perform XRootD connection handshake:
 * 1. Send ClientInitHandShake(20B) + kXR_protocol(24B) merged = 44 bytes
 * 2. Receive ServerResponseHeader(8B) + ServerInitHandShake(12B) = 20 bytes
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

  const _serverInit = await readExact(transport, 8 + 12)

  const protoFrame = await waitForFrame(mux)

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

  const loginFrame = await waitForFrame(mux)

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

interface ITransport {
  send(data: Buffer): Promise<void>
  onData(callback: (chunk: Buffer) => void): void
}

function readExact(transport: ITransport, nbytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    let received = 0

    const handler = (chunk: Buffer) => {
      chunks.push(chunk)
      received += chunk.length
      if (received >= nbytes) {
        transport.onData(() => {})
        resolve(Buffer.concat(chunks).subarray(0, nbytes))
      }
    }

    transport.onData(handler)
  })
}

import { Framer } from '../transport/framer.ts'

function waitForFrame(mux: Multiplexer): Promise<Frame> {
  const framer = new Framer()

  return new Promise<Frame>((resolve) => {
    const transport = (mux as unknown as { transport: ITransport }).transport

    transport.onData((chunk: Buffer) => {
      const frames = framer.feed(chunk)
      for (const frame of frames) {
        resolve(frame)
        return
      }
    })
  })
}
