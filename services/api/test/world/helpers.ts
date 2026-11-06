import type { EnrollmentRow, WorldRepo } from "../../src/world/verify";

export function memoryWorldRepo(): WorldRepo & { rows: EnrollmentRow[] } {
  const rows: EnrollmentRow[] = [];
  return {
    rows,
    async insertEnrollment(r) {
      if (rows.some((x) => x.action === r.action && x.nullifier === r.nullifier)) return "duplicate";
      rows.push(r);
      return "inserted";
    },
    async findByMerchant(m, a) {
      return rows.find((x) => x.merchantId === m && x.action === a) ?? null;
    },
    async nullifiersFor(ids, a) {
      return rows.filter((x) => ids.includes(x.merchantId) && x.action === a).map((x) => ({ merchantId: x.merchantId, nullifier: x.nullifier }));
    },
  };
}

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (o: unknown) => b64u(enc.encode(JSON.stringify(o)));

export async function rsaKey() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  return { priv: kp.privateKey, jwks: { keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid: "k1", use: "sig", alg: "RS256" }] } };
}

export async function signJwt(priv: CryptoKey, claims: object, header: object = { alg: "RS256", kid: "k1" }) {
  const input = `${part(header)}.${part(claims)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, enc.encode(input));
  return `${input}.${b64u(sig)}`;
}
export const unsigned = (claims: object, header: object, sig = "AAAA") => `${part(header)}.${part(claims)}.${sig}`;
