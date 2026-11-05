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
