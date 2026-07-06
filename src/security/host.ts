import type { AuthParams, SecEntity, SecurityProtocol } from "./interface.ts";

export class HostAuth implements SecurityProtocol {
  readonly name = "host";
  private entity: SecEntity = { prot: "host", uid: 0, gid: 0 };
  private complete = false;

  async getCredentials(params: AuthParams): Promise<Uint8Array> {
    // C++ host protocol sends "host\0" (5 bytes) as credential data.
    // The null terminator is required for PManager.Find() strcmp() matching.
    return new Uint8Array([0x68, 0x6f, 0x73, 0x74, 0x00]); // "host\0"
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
