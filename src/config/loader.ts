import { readFileSync } from "node:fs";
import type { XRootDUrl } from "../url/url.ts";
import type { SecEnv } from "./sec-env.ts";

export interface ResolvedAuthConfig {
  username?: string;
  password?: string;
  sssKey?: Buffer;
}

/**
 * Resolve authentication credentials from multiple sources.
 *
 * Priority (high → low):
 *   1. options.credentials (explicit)
 *   2. URL userinfo (root://user:pass@host)
 *   3. SecEnv XrdSecUSER / XrdSecCREDS
 *
 * Also reads the SSS keytab file specified by SecEnv if available.
 */
export function loadAuthConfig(options: {
  url?: XRootDUrl;
  credentials?: { username: string; password?: string };
  secEnv?: SecEnv;
}): ResolvedAuthConfig {
  const { url, credentials, secEnv } = options;

  const username =
    credentials?.username ?? url?.user ?? secEnv?.username;
  const password =
    credentials?.password ?? url?.password ?? secEnv?.password;

  let sssKey: Buffer | undefined;
  if (secEnv?.sssKeytab) {
    try {
      sssKey = readFileSync(secEnv.sssKeytab);
    } catch {
      // File not found or unreadable — SSS not available.
    }
  }

  return { username, password, sssKey };
}
