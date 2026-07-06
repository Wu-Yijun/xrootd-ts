import { hostname } from "node:os";
import type { AuthParams, SecEntity, SecurityProtocol } from "./interface.ts";

/**
 * Unix authentication protocol.
 *
 * Sends the local username and group to the server in plaintext.
 * This is the lowest-security authentication protocol in XRootD —
 * the server trusts the client to honestly report its identity.
 *
 * Credential format: "unix\0" + username + " " + group
 *
 * Typically used in trusted internal network environments only.
 */
export class UnixAuth implements SecurityProtocol {
  readonly name = "unix";
  private entity: SecEntity = { prot: "unix", uid: 0, gid: 0 };
  private complete = false;

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    const username = params.username || process.env.USER ||
      process.env.LOGNAME || "unknown";
    const group = process.env.GROUP || process.env.LOGNAME || "unknown";
    const encoder = new TextEncoder();

    const prefix = encoder.encode("unix\0");
    const identity = encoder.encode(`${username} ${group}`);

    const result = new Uint8Array(prefix.length + identity.length);
    result.set(prefix);
    result.set(identity, prefix.length);

    this.entity.name = username;
    this.entity.host = hostname();

    return result;
  }

  async processChallenge(_challenge: Uint8Array): Promise<Uint8Array> {
    this.complete = true;
    return new Uint8Array(0);
  }

  isComplete(): boolean {
    return this.complete;
  }

  getEntity(): SecEntity {
    return this.entity;
  }
}
