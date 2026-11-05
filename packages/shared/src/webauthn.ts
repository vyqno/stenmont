import { encodeAbiParameters, toHex, type Hex } from "viem";

/** The P-256 group order. PasskeyAccount only accepts signatures with s <= N/2 (low-s). */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** Reads r and s from the ASN.1 DER signature a WebAuthn authenticator returns. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  const bad = () => new Error("invalid DER signature");
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) throw bad();
  let i = 2;
  const readInt = () => {
    if (der[i] !== 0x02) throw bad();
    const len = der[i + 1];
    if (len === undefined || len === 0 || len > 33 || i + 2 + len > der.length) throw bad();
    const bytes = der.subarray(i + 2, i + 2 + len);
    i += 2 + len;
    return BigInt(toHex(bytes));
  };
  const r = readInt();
  const s = readInt();
  if (i !== der.length) throw bad();
  return { r, s };
}

/** s -> N - s when s is in the upper half. Authenticators do not normalise, the contract requires it. */
export const lowS = (s: bigint): bigint => (s > P256_N / 2n ? P256_N - s : s);

/** Extracts the P-256 public key (x, y) from the SPKI that `getPublicKey()` returns after registration. */
export function spkiToPublicKey(spki: Uint8Array): { x: Hex; y: Hex } {
  const at = spki.length - 65; // an uncompressed point (0x04 || x || y) is the last 65 bytes of a P-256 SPKI
  if (at < 0 || spki[at] !== 0x04) throw new Error("not an uncompressed P-256 SPKI key");
  return { x: toHex(spki.subarray(at + 1, at + 33)), y: toHex(spki.subarray(at + 33, at + 65)) };
}

function indexOfBytes(haystack: Uint8Array, needle: string): number {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * The signature PasskeyAccount.isValidSignature expects: the six WebAuthn fields ABI-encoded FLAT (not as a struct):
 * abi.encode(r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON). The WebAuthn challenge must have been
 * the 32-byte digest being signed.
 */
export function encodeWebAuthnSignature(a: {
  r: bigint;
  s: bigint;
  authenticatorData: Uint8Array;
  clientDataJSON: string;
}): Hex {
  const cd = new TextEncoder().encode(a.clientDataJSON);
  const challengeIndex = indexOfBytes(cd, '"challenge"');
  const typeIndex = indexOfBytes(cd, '"type"');
  if (challengeIndex < 0 || typeIndex < 0) throw new Error("clientDataJSON has no type or challenge field");
  const word = (n: bigint) => toHex(n, { size: 32 });
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "string" }],
    [word(a.r), word(lowS(a.s)), BigInt(challengeIndex), BigInt(typeIndex), toHex(a.authenticatorData), a.clientDataJSON],
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Server-side verification (sign-in). The same rules the PasskeyAccount contract applies, in WebCrypto so it runs in
// browsers, Workers and Node.

export const b64urlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export type AssertionCheck =
  | { ok: true; counter: number; userVerified: boolean }
  | { ok: false; reason: "client_data" | "type" | "challenge" | "origin" | "authenticator_data" | "rp" | "user_presence" | "user_verification" | "signature" };

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const fail = (reason: Exclude<AssertionCheck, { ok: true }>["reason"]): AssertionCheck => ({ ok: false, reason });

/** Verifies a WebAuthn assertion (a passkey sign-in) against the public key stored at registration. Never throws. */
export async function verifyAssertion(a: {
  authenticatorData: Uint8Array;
  clientDataJSON: string;
  signatureDer: Uint8Array;
  publicKey: { x: Hex; y: Hex };
  expectedChallenge: Uint8Array;
  expectedOrigin: string;
  expectedRpId: string;
  requireUserVerification?: boolean;
}): Promise<AssertionCheck> {
  let client: { type?: string; challenge?: string; origin?: string };
  try {
    client = JSON.parse(a.clientDataJSON);
  } catch {
    return fail("client_data");
  }
  if (client.type !== "webauthn.get") return fail("type");
  if (client.challenge !== b64urlEncode(a.expectedChallenge)) return fail("challenge");
  if (client.origin !== a.expectedOrigin) return fail("origin");

  const data = a.authenticatorData;
  if (data.length < 37) return fail("authenticator_data");
  if (!equal(data.subarray(0, 32), await sha256(new TextEncoder().encode(a.expectedRpId)))) return fail("rp");
  const flags = data[32]!;
  if (!(flags & 0x01)) return fail("user_presence");
  if (a.requireUserVerification && !(flags & 0x04)) return fail("user_verification");

  try {
    const { r, s } = parseDerSignature(a.signatureDer);
    const raw = new Uint8Array(64);
    raw.set(Uint8Array.from(Buffer_hex(toHex(r, { size: 32 }))), 0);
    raw.set(Uint8Array.from(Buffer_hex(toHex(s, { size: 32 }))), 32);
    const point = new Uint8Array(65);
    point[0] = 0x04;
    point.set(Buffer_hex(a.publicKey.x), 1);
    point.set(Buffer_hex(a.publicKey.y), 33);
    const key = await crypto.subtle.importKey("raw", point, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const message = new Uint8Array([...data, ...(await sha256(new TextEncoder().encode(a.clientDataJSON)))]);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, message))) return fail("signature");
  } catch {
    return fail("signature");
  }
  const counter = ((data[33]! << 24) | (data[34]! << 16) | (data[35]! << 8) | data[36]!) >>> 0;
  return { ok: true, counter, userVerified: !!(flags & 0x04) };
}

const Buffer_hex = (h: string): number[] => (h.replace(/^0x/, "").match(/../g) ?? []).map((b) => parseInt(b, 16));
