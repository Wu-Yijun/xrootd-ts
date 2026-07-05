import type { SecurityProtocol, AuthParams, SecEntity } from '../security/interface.ts'
import type { Multiplexer } from '../transport/multiplexer.ts'
import type { Frame } from '../transport/framer.ts'
import { RequestId, ResponseStatus } from '../protocol/constants.ts'
import { buildAuthRequest, parseErrorResponse } from '../protocol/message.ts'
import { XRootDError } from '../api/errors.ts'

const authProtocols = new Map<string, () => SecurityProtocol>()

export function registerAuthProtocol(
  name: string,
  factory: () => SecurityProtocol,
): void {
  authProtocols.set(name, factory)
}

export async function doAuthentication(
  mux: Multiplexer,
  secReqs: string,
  params: AuthParams,
): Promise<SecEntity> {
  const supportedProtocols = secReqs.split(',').map((s) => s.trim())

  for (const protoName of supportedProtocols) {
    const factory = authProtocols.get(protoName)
    if (!factory) continue

    const protocol = factory()
    return await executeAuth(mux, protocol, params)
  }

  throw new XRootDError(
    3030,
    `No supported authentication protocol. Server requires: ${secReqs}`,
  )
}

async function executeAuth(
  mux: Multiplexer,
  protocol: SecurityProtocol,
  params: AuthParams,
): Promise<SecEntity> {
  const creds = await protocol.getCredentials(params)
  const credType = getCredType(protocol.name)

  let frame = await mux.request(
    RequestId.Auth,
    new Uint8Array(16),
    buildAuthRequest(0, credType, creds),
  )

  while (frame.status === ResponseStatus.Authmore) {
    const challenge = frame.body
    const response = await protocol.processChallenge(challenge)
    frame = await mux.request(
      RequestId.Auth,
      new Uint8Array(16),
      buildAuthRequest(0, credType, response),
    )
  }

  if (frame.status !== ResponseStatus.Ok) {
    const { errnum, errmsg } = parseErrorResponse(frame.body)
    throw new XRootDError(errnum || 3030, errmsg || `Authentication failed with protocol: ${protocol.name}`)
  }

  return protocol.getEntity()
}

function getCredType(name: string): number {
  switch (name) {
    case 'host': return 0
    case 'sss': return 1
    case 'unix': return 2
    case 'krb5': return 3
    case 'gsi': return 4
    default: throw new Error(`Unknown auth protocol: ${name}`)
  }
}
