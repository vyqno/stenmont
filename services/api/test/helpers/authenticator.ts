import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { b64urlEncode } from "@stenmont/shared";

/** A software passkey: enough of a WebAuthn authenticator to drive the server's registration and sign-in. */
export function fakeAuthenticator(origin = "https://app.test", rpId = "app.test") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const credentialId = randomBytes(16);
  let counter = 0;
  const sha256 = (d: Buffer | string) => createHash("sha256").update(d).digest();

  return {
    credentialId: b64urlEncode(credentialId),
    publicKeySpki: b64urlEncode(spki),

    /** What the browser returns from navigator.credentials.create (attestation "none"). */
    attestation(challenge: string, over: { origin?: string; type?: string; challenge?: string } = {}) {
      const clientData = JSON.stringify({ type: over.type ?? "webauthn.create", challenge: over.challenge ?? challenge, origin: over.origin ?? origin });
      return {
        credentialId: b64urlEncode(credentialId),
        publicKey: b64urlEncode(spki),
        clientDataJSON: b64urlEncode(Buffer.from(clientData)),
      };
    },

    /** What the browser returns from navigator.credentials.get for this challenge (any bytes the server asked for). */
    assertion(challenge: Uint8Array, over: { uv?: boolean; origin?: string; counter?: number; challengeOverride?: Uint8Array } = {}) {
      const uv = over.uv ?? true;
      counter = over.counter ?? counter + 1;
      const clientData = JSON.stringify({ type: "webauthn.get", challenge: b64urlEncode(over.challengeOverride ?? challenge), origin: over.origin ?? origin });
      const flags = 0x01 | (uv ? 0x04 : 0);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), c]);
      const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(clientData)])).sign({ key: privateKey, dsaEncoding: "der" });
      return {
        credentialId: b64urlEncode(credentialId),
        authenticatorData: b64urlEncode(authData),
        clientDataJSON: b64urlEncode(Buffer.from(clientData)),
        signature: b64urlEncode(signature),
      };
    },
  };
}
