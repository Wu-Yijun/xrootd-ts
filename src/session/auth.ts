import type {
  AuthParams,
  SecEntity,
  SecurityProtocol,
} from "../security/interface.ts";
import type { Multiplexer } from "../transport/multiplexer.ts";
import type { ResolvedAuthConfig } from "../config/loader.ts";
import {
  ClientError,
  RequestId,
  ResponseStatus,
  ServerError,
} from "../protocol/constants.ts";
import { parseErrorResponse } from "../protocol/message.ts";
import { XRootDError } from "../api/errors.ts";

/**
 * Auth protocol registry: maps protocol name to a factory function.
 *
 * The factory receives the current connection's auth config at call time,
 * allowing per-connection credentials (e.g. SSS keytab) instead of
 * module-level singletons. Config-agnostic protocols (host, unix, krb5)
 * simply ignore the parameter.
 */
const authProtocolRegistry = new Map<
  string,
  (authConfig?: ResolvedAuthConfig) => SecurityProtocol
>();

export function registerAuthProtocol(
  name: string,
  factory: (authConfig?: ResolvedAuthConfig) => SecurityProtocol,
): void {
  authProtocolRegistry.set(name, factory);
}

export async function doAuthentication(
  mux: Multiplexer,
  authProtocols: string[],
  params: AuthParams,
  options?: {
    protocolFilter?: string[];
    authConfig?: ResolvedAuthConfig;
  },
): Promise<SecEntity> {
  if (authProtocols.length === 0) {
    return { prot: "", uid: 0, gid: 0 };
  }

  const filter = options?.protocolFilter;
  const authConfig = options?.authConfig;
  const candidates = filter?.length
    ? authProtocols.filter((p) => filter.includes(p))
    : authProtocols;

  let lastError: Error | null = null;

  for (const protoName of candidates) {
    const factory = authProtocolRegistry.get(protoName);
    if (!factory) continue;

    const protocol = factory(authConfig);
    try {
      return await executeAuth(mux, protocol, params);
    } catch (err) {
      lastError = err as Error;
      // Protocol failed, try the next one (fallback behavior matching C++ client)
    }
  }

  throw new XRootDError(
    ServerError.AuthFailed,
    `All authentication methods failed. Server requires: ${
      authProtocols.join(", ")
    }` +
      (filter ? `. Allowed: ${filter.join(",")}` : "") +
      (lastError ? `. Last error: ${lastError.message}` : ""),
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
