export interface AuthParams {
  host: string;
  port: number;
  username?: string;
  password?: string;
  sessid: Uint8Array;
  /** Kerberos SPN prefix parsed from server secToken (e.g. "xrootd" or "host"). */
  spnPrefix?: string;
}

export interface SecEntity {
  prot: string;
  name?: string;
  host?: string;
  uid: number;
  gid: number;
}

export interface SecurityProtocol {
  readonly name: string;
  getCredentials(params: AuthParams): Promise<Uint8Array>;
  processChallenge(challenge: Uint8Array): Promise<Uint8Array>;
  isComplete(): boolean;
  getEntity(): SecEntity;
}
