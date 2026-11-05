import { describe, expect, it } from "vitest";
import {
  P256_N,
  encodeWebAuthnSignature,
  lowS,
  parseDerSignature,
  spkiToPublicKey,
} from "../src/webauthn";

// A real assertion generated with Node's crypto (DER signature, SPKI key), and its expected encoding computed
// independently with `cast abi-encode`. The same bytes are asserted against PasskeyAccount in
// contracts/test/PasskeyAccount.t.sol (test_realBrowserVector_validates), so TypeScript and Solidity cannot drift.
const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const V = {
  spki: "3059301306072a8648ce3d020106082a8648ce3d0301070342000405fe80fedc81b78bbd6c429efc0711b7291065b569355bd388821b68f7c252491a1da471c25f67dd6f4f02207fd8938182be138f50d5e02f2447267993125b6d",
  x: "0x05fe80fedc81b78bbd6c429efc0711b7291065b569355bd388821b68f7c25249",
  y: "0x1a1da471c25f67dd6f4f02207fd8938182be138f50d5e02f2447267993125b6d",
  authData: "202f04926da78dc348a12b16cdf1e242ef13e07c620b54e871be278ed3df3c180500000001",
  clientDataJSON: "{\"type\":\"webauthn.get\",\"challenge\":\"pjknz1j1jR5Mb-Z7OQKJpRJI1tufPFBOsj2US7E0ze0\",\"origin\":\"https://app.stenmont.com\",\"crossOrigin\":false}",
  der: "3045022100c71b1318b63678d92468c152bdb4cf0b97910e4c347af86f3e07882864c4374b022073d4cd288aa5f65bedfaa63a1eca0560efd4f98078fe8819ebdf45e6612ff0da",
  r: "0xc71b1318b63678d92468c152bdb4cf0b97910e4c347af86f3e07882864c4374b",
  s: "0x73d4cd288aa5f65bedfaa63a1eca0560efd4f98078fe8819ebdf45e6612ff0da",
  sLow: "0x73d4cd288aa5f65bedfaa63a1eca0560efd4f98078fe8819ebdf45e6612ff0da",
  encoded: "0xc71b1318b63678d92468c152bdb4cf0b97910e4c347af86f3e07882864c4374b73d4cd288aa5f65bedfaa63a1eca0560efd4f98078fe8819ebdf45e6612ff0da0000000000000000000000000000000000000000000000000000000000000017000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000025202f04926da78dc348a12b16cdf1e242ef13e07c620b54e871be278ed3df3c18050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000897b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22706a6b6e7a316a316a52354d622d5a374f514b4a70524a49317475665046424f736a3255533745307a6530222c226f726967696e223a2268747470733a2f2f6170702e7374656e6d6f6e742e636f6d222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000",
};

describe("webauthn helpers", () => {
  it("parseDerSignature reads r and s from a real DER signature", () => {
    const { r, s } = parseDerSignature(hex(V.der));
    expect(`0x${r.toString(16).padStart(64, "0")}`).toBe(V.r);
    expect(`0x${s.toString(16).padStart(64, "0")}`).toBe(V.s);
  });
  it("spkiToPublicKey extracts the P-256 point", () => {
    expect(spkiToPublicKey(hex(V.spki))).toEqual({ x: V.x, y: V.y });
  });
  it("lowS flips only high values", () => {
    expect(lowS(5n)).toBe(5n);
    expect(lowS(P256_N / 2n)).toBe(P256_N / 2n);
    expect(lowS(P256_N / 2n + 1n)).toBe(P256_N - (P256_N / 2n + 1n));
    expect(lowS(P256_N - 1n)).toBe(1n);
  });
  it("encodeWebAuthnSignature matches the independently computed encoding (and normalises s)", () => {
    const { r, s } = parseDerSignature(hex(V.der));
    expect(encodeWebAuthnSignature({ r, s, authenticatorData: hex(V.authData), clientDataJSON: V.clientDataJSON })).toBe(V.encoded);
  });
  it("a high-s signature is flipped to low-s before encoding (authenticators do not normalise)", () => {
    const { r, s } = parseDerSignature(hex(V.der));
    const highS = s > P256_N / 2n ? s : P256_N - s;
    expect(encodeWebAuthnSignature({ r, s: highS, authenticatorData: hex(V.authData), clientDataJSON: V.clientDataJSON })).toBe(V.encoded);
  });
  it("rejects malformed DER and keys, and client data without the expected fields", () => {
    expect(() => parseDerSignature(hex("3006020101020101").subarray(0, 5))).toThrow();
    expect(() => parseDerSignature(hex("00"))).toThrow();
    expect(() => spkiToPublicKey(hex("00".repeat(10)))).toThrow();
    expect(() => encodeWebAuthnSignature({ r: 1n, s: 1n, authenticatorData: hex("00"), clientDataJSON: "{}" })).toThrow();
  });
});
