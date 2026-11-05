import { toHex, type Hex } from "viem";
import { encodeWebAuthnSignature, parseDerSignature, spkiToPublicKey } from "@stenmont/shared";
import { b64urlDecode, b64urlEncode } from "./pay";

const STORAGE_KEY = "stenmont.passkey.v1";
const rp = () => location.hostname;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export type StoredPasskey = { credentialId: string; qx: Hex; qy: Hex };

/**
 * The passkey for this browser. The account address comes from its public key, so the public key is kept next to the
 * credential id. Limitation: clearing site data loses the link to the account.
 */
export function loadPasskey(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPasskey) : null;
  } catch {
    return null;
  }
}

export async function createPasskey(): Promise<StoredPasskey> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Stenmont", id: rp() },
      user: { id: random(16), name: "customer", displayName: "Stenmont customer" },
      challenge: random(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 = P-256
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey();
  if (!spki) throw new Error("no public key");
  const { x, y } = spkiToPublicKey(new Uint8Array(spki));
  const stored = { credentialId: b64urlEncode(new Uint8Array(cred.rawId)), qx: x, qy: y };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

/** Asks for Face ID / fingerprint / PIN and returns the signature PasskeyAccount accepts for this 32-byte digest. */
export async function signDigest(p: StoredPasskey, digest: Hex): Promise<Hex> {
  const asn = (await navigator.credentials.get({
    publicKey: {
      challenge: Uint8Array.from(Buffer_from_hex(digest)),
      allowCredentials: [{ type: "public-key", id: b64urlDecode(p.credentialId) as BufferSource }],
      userVerification: "required",
      rpId: rp(),
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!asn) throw new Error("cancelled");
  const r = asn.response as AuthenticatorAssertionResponse;
  const { r: rr, s } = parseDerSignature(new Uint8Array(r.signature));
  return encodeWebAuthnSignature({
    r: rr,
    s,
    authenticatorData: new Uint8Array(r.authenticatorData),
    clientDataJSON: new TextDecoder().decode(r.clientDataJSON),
  });
}

const Buffer_from_hex = (h: Hex) => (h.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16));
void toHex;
