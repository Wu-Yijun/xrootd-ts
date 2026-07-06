/**
 * Response type definitions for XRootD protocol messages.
 */

import type { DirectoryEntry } from "../api/types.ts";

/** Protocol response from kXR_protocol. */
export interface ProtocolResponse {
  pval: number;
  flags: number;
  /** Security level from secReqs struct (0=none, 1=compat, 2=std, 3=intense, 4=pedantic). */
  seclvl?: number;
  /** Security options from secReqs struct. */
  secopt?: number;
  /** Bind preferences from bifReqs struct (comma-separated protocol list). */
  bifReqs?: string;
}

/** Login response from kXR_login. */
export interface LoginResponse {
  sessid: Uint8Array;
  secToken?: Uint8Array;
  needsAuth: boolean;
}

/** Open response from kXR_open. */
export interface OpenResponse {
  fhandle: Uint8Array;
  cpsize: number;
  cptype: string;
}

/** Error response from kXR_error. */
export interface ErrorResponse {
  errnum: number;
  errmsg: string;
}

/** Redirect response from kXR_redirect. */
export interface RedirectResponse {
  port: number;
  host: string;
}

/** Wait response from kXR_wait / kXR_waitresp. */
export interface WaitResponse {
  seconds: number;
  infomsg: string;
}

/** Directory listing response from kXR_dirlist. */
export interface DirlistResponse {
  entries: DirectoryEntry[];
}
