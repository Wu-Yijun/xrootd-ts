import type {
  AuthParams,
  SecEntity,
  SecurityProtocol,
} from "../security/interface.ts";
import type { Multiplexer } from "../transport/multiplexer.ts";
import {
  ClientError,
  RequestId,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import { parseErrorResponse } from "../protocol/message.ts";
import { XRootDError } from "../api/errors.ts";

const authProtocolRegistry = new Map<string, () => SecurityProtocol>();

export function registerAuthProtocol(
  name: string,
  factory: () => SecurityProtocol,
): void {
  authProtocolRegistry.set(name, factory);
}

export async function doAuthentication(
  mux: Multiplexer,
  authProtocols: string[],
  params: AuthParams,
  options?: { protocolFilter?: string[] },
): Promise<SecEntity> {
  if (authProtocols.length === 0) {
    return { prot: "", uid: 0, gid: 0 };
  }

  const filter = options?.protocolFilter;
  const candidates = filter?.length
    ? authProtocols.filter((p) => filter.includes(p))
    : authProtocols;

  for (const protoName of candidates) {
    const factory = authProtocolRegistry.get(protoName);
    if (!factory) continue;

    const protocol = factory();
    return await executeAuth(mux, protocol, params);
  }

  throw new XRootDError(
    ServerError.AuthFailed,
    `No supported authentication protocol. Server requires: ${authProtocols.join(", ")}` +
      (filter ? `. Allowed: ${filter.join(",")}` : ""),
  );
}

async function executeAuth(
  mux: Multiplexer,
  protocol: SecurityProtocol,
  params: AuthParams,
): Promise<SecEntity> {
  const creds = await protocol.getCredentials(params);

  // Build auth body: reserved[12] + credtype[4]
  // credtype is a 4-byte protocol name string (e.g. "krb5", "host"), NOT a numeric value.
  const body = new Uint8Array(16);
  const nameBytes = new TextEncoder().encode(protocol.name);
  body.set(nameBytes.subarray(0, 4), 12);

  let frame = await mux.request(
    RequestId.Auth,
    body,
    creds,
  );

  while (frame.status === ResponseStatus.Authmore) {
    const challenge = frame.body;
    const response = await protocol.processChallenge(challenge);
    frame = await mux.request(
      RequestId.Auth,
      body,
      response,
    );
  }

  if (frame.status !== ResponseStatus.Ok) {
    const { errnum, errmsg } = parseErrorResponse(frame.body);
    throw new XRootDError(
      errnum || ServerError.AuthFailed,
      errmsg || `Authentication failed with protocol: ${protocol.name}`,
    );
  }

  return protocol.getEntity();
}
