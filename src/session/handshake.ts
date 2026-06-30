import { Multiplexer } from '../transport/multiplexer.js'
import { XRootDUrl } from '../url/url.js'
import {
  PROTOCOL_VERSION,
  kXR_secreqs,
  kXR_bifreqs,
  kXR_ExpLogin,
  ResponseStatus,
} from '../protocol/constants.js'
import {
  buildHandshakeAndProtocol,
  buildLoginRequest,
  parseProtocolResponse,
  parseLoginResponse,
  parseRedirectResponse,
  parseErrorBody,
} from '../protocol/message.js'

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

  const transport = (mux as unknown as { transport: { send: (data: Buffer) => Promise<void> } }).transport
  await transport.send(handshakeBuf)

  const handshakeResp = await readExact(mux, 8 + 12)

  const protoFlags = handshakeResp.readUInt16BE(2)
  void protoFlags

  const protoFrame = await waitForFrame(mux)

  if (protoFrame.status === ResponseStatus.Error) {
    const err = parseErrorBody(protoFrame.body)
    throw new Error(`Protocol handshake error: ${err.errmsg} (${err.errnum})`)
  }

  if (protoFrame.status !== ResponseStatus.Ok) {
    throw new Error(`Unexpected protocol response status: ${protoFrame.status}`)
  }

  const protoResp = parseProtocolResponse(protoFrame.body)

  const loginBuf = buildLoginRequest(0, pid, username, 0, '')
  await transport.send(loginBuf)

  const loginFrame = await waitForFrame(mux)

  if (loginFrame.status === ResponseStatus.Error) {
    const err = parseErrorBody(loginFrame.body)
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

async function readExact(mux: Multiplexer, nbytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let received = 0

  return new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      received += chunk.length
      if (received >= nbytes) {
        const buf = Buffer.concat(chunks)
        resolve(buf.subarray(0, nbytes))
      }
    }

    const transport = (mux as unknown as {
      transport: { onData: (cb: (chunk: Buffer) => void) => void }
    }).transport

    const origOnData = transport.onData.bind(transport)
    transport.onData((chunk: Buffer) => {
      onData(chunk)
    })

    void origOnData
  })
}

async function waitForFrame(mux: Multiplexer): Promise<import('../transport/framer.js').Frame> {
  const { Framer } = await import('../transport/framer.js')
  const framer = new Framer()

  return new Promise<resolve>((resolve) => {
    const transport = (mux as unknown as {
      transport: { onData: (cb: (chunk: Buffer) => void) => void }
    }).transport

    transport.onData((chunk: Buffer) => {
      const frames = framer.feed(chunk)
      for (const frame of frames) {
        resolve(frame)
        return
      }
    })
  })
}
