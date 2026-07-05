import { homedir } from "node:os";

export interface SecEnvOptions {
  /** Environment variable source. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Protocol whitelist (equivalent to XrdSecPROTOCOL). */
  protocolFilter?: string[];
  /** Whether to read GSI variables (X509_*, XrdSecGSI*). Defaults to true. */
  gsi?: boolean;
  /** Whether to read SSS variables (XrdSecSSSKT). Defaults to true. */
  sss?: boolean;
  /** Whether to read KRB5 variables (XrdSecKRB5INITTKN). Defaults to true. */
  krb5?: boolean;
  /** Whether to read PWD variables (XrdSecPWDSRVPUK etc). Defaults to true. */
  pwd?: boolean;
}

/**
 * xrootd security environment variable configuration.
 *
 * Maps C++ xrootd's XrdSec* / X509_* environment variables to a structured
 * config object. Does NOT read process.env directly — the caller provides
 * the env source via constructor options.
 */
export class SecEnv {
  readonly protocolFilter: string[];
  readonly proxyMode: boolean;
  readonly proxyCreds: boolean;

  readonly sssKeytab: string | undefined;

  readonly krb5InitToken: boolean;

  readonly gsiCaDir: string;
  readonly gsiCrlDir: string;
  readonly gsiUserCert: string;
  readonly gsiUserKey: string;
  readonly gsiUserProxy: string;

  readonly pwdServerPubkey: string | undefined;

  readonly username: string | undefined;
  readonly password: string | undefined;

  constructor(options: SecEnvOptions = {}) {
    const env = options.env ?? process.env;

    this.protocolFilter = options.protocolFilter ??
      this.parseProtocolFilter(env);
    this.proxyMode = truthy(env["XrdSecPROXY"]);
    this.proxyCreds = truthy(env["XrdSecPROXYCREDS"]);

    this.sssKeytab = options.sss !== false
      ? (env["XrdSecSSSKT"] ?? env["XrdSecsssKT"])
      : undefined;

    this.krb5InitToken = options.krb5 !== false
      ? truthy(env["XrdSecKRB5INITTKN"])
      : false;

    if (options.gsi !== false) {
      const home = homedir();
      this.gsiCaDir = env["XrdSecGSICADIR"] ?? env["X509_CERT_DIR"] ??
        "/etc/grid-security/certificates";
      this.gsiCrlDir = env["XrdSecGSICRLDIR"] ?? env["X509_CERT_DIR"] ??
        "/etc/grid-security/certificates";
      this.gsiUserCert = env["XrdSecGSIUSERCERT"] ?? env["X509_USER_CERT"] ??
        `${home}/.globus/usercert.pem`;
      this.gsiUserKey = env["XrdSecGSIUSERKEY"] ?? env["X509_USER_KEY"] ??
        `${home}/.globus/userkey.pem`;
      this.gsiUserProxy = env["XrdSecGSIUSERPROXY"] ?? env["X509_USER_PROXY"] ??
        `/tmp/x509up_u${process.getuid?.() ?? 0}`;
    } else {
      this.gsiCaDir = "";
      this.gsiCrlDir = "";
      this.gsiUserCert = "";
      this.gsiUserKey = "";
      this.gsiUserProxy = "";
    }

    this.pwdServerPubkey = options.pwd !== false
      ? env["XrdSecPWDSRVPUK"]
      : undefined;

    this.username = env["XrdSecUSER"];
    this.password = env["XrdSecCREDS"];
  }

  static fromEnv(
    env?: Record<string, string | undefined>,
    options?: Omit<SecEnvOptions, "env">,
  ): SecEnv {
    return new SecEnv({ ...options, env: env ?? process.env });
  }

  private parseProtocolFilter(
    env: Record<string, string | undefined>,
  ): string[] {
    const raw = env["XrdSecPROTOCOL"];
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

function truthy(val: string | undefined): boolean {
  return val !== undefined && val !== "0" && val !== "";
}
