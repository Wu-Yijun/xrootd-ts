import { Transport } from "../transport/transport.ts";
import { Multiplexer } from "../transport/multiplexer.ts";
import type { DetachedRequest } from "../transport/multiplexer.ts";
import { handshake } from "./handshake.ts";
import { doAuthentication, registerAuthProtocol } from "./auth.ts";
import { loadAuthConfig } from "../config/loader.ts";
import { HostAuth } from "../security/host.ts";
import { SSSAuth } from "../security/sss.ts";
import { UnixAuth } from "../security/unix.ts";
import { Krb5Auth } from "../security/krb5.ts";
import { XRootDUrl } from "../url/url.ts";
import type { Session } from "./handshake.ts";
import type { SecEnv } from "../config/sec-env.ts";
import { DEFAULT_MAX_REDIRECTS } from "../protocol/constants.ts";
import { ClientError } from "../protocol/constants.ts";
import { XRootDError } from "../api/errors.ts";

let authProtocolsRegistered = false;

function ensureAuthProtocolsRegistered(
  url: XRootDUrl,
  credentials?: { username: string; password?: string },
  secEnv?: SecEnv,
): void {
  if (authProtocolsRegistered) return;

  const authConfig = loadAuthConfig({ url, credentials, secEnv });

  registerAuthProtocol("host", () => new HostAuth());
  registerAuthProtocol("unix", () => new UnixAuth());
  if (authConfig.sssKey && SSSAuth.isSupported()) {
    registerAuthProtocol("sss", () => new SSSAuth(authConfig.sssKey!));
  }
  if (Krb5Auth.isSupported()) {
    registerAuthProtocol("krb5", () => new Krb5Auth());
  }

  authProtocolsRegistered = true;
}

export interface ConnectOptions {
  credentials?: { username: string; password?: string };
  timeout?: number;
  maxRedirects?: number;
  redirectCount?: number;
  tls?: { rejectUnauthorized?: boolean };
  secEnv?: SecEnv;
  onRedirect?: (
    host: string,
    port: number,
    pending: DetachedRequest,
  ) => Promise<void>;
}

export interface ConnectionResult {
  transport: Transport;
  mux: Multiplexer;
  session: Session;
}

/**
 * Establish a connection to an XRootD host: create Transport, Multiplexer,
 * perform handshake and authentication. Reusable by both Client and File.
 */
export async function connectToHost(
  url: XRootDUrl,
  options: ConnectOptions = {},
): Promise<ConnectionResult> {
  ensureAuthProtocolsRegistered(url, options.credentials, options.secEnv);

  const transport = new Transport();
  await transport.connect(
    url.host,
    url.port,
    url.isSecure(),
    options.tls,
  );

  const mux = new Multiplexer(transport, {
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    redirectCount: options.redirectCount ?? 0,
    onRedirect: options.onRedirect,
  });

  if (options.timeout) {
    mux.setTimeout(options.timeout);
  }

  let session: Session;
  try {
    session = await handshake(mux, url, {
      username: options.credentials?.username,
    });
  } catch (err) {
    mux.close();
    await transport.close();
    throw err;
  }

  if (session.needsAuth && session.authProtocols?.length) {
    const authConfig = loadAuthConfig({
      url,
      credentials: options.credentials,
      secEnv: options.secEnv,
    });

    try {
      const secEntity = await doAuthentication(
        mux,
        session.authProtocols,
        {
          host: url.host,
          port: url.port,
          username: authConfig.username,
          password: authConfig.password,
          sessid: session.sessid,
          spnPrefix: session.spnPrefix,
        },
        { protocolFilter: options.secEnv?.protocolFilter },
      );
      session.secEntity = secEntity;
    } catch (err) {
      mux.close();
      await transport.close();
      throw err;
    }
  }

  return { transport, mux, session };
}
