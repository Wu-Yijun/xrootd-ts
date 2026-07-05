import type { AuthParams, SecEntity, SecurityProtocol } from "./interface.ts";

export class HostAuth implements SecurityProtocol {
  readonly name = "host";
  private entity: SecEntity = { prot: "host", uid: 0, gid: 0 };
  private complete = false;

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    const hostname = params.host || "unknown";
    const encoder = new TextEncoder();
    return encoder.encode(hostname);
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
