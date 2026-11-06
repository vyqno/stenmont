import { hexToBytes, keccak256, recoverMessageAddress, concat, numberToBytes, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createRpContext } from "../../src/world/rp";

const KEY = `0x${"11".repeat(32)}` as const;
const base = { rpId: "rp_123", action: "enrol-business", signingKey: KEY, now: () => new Date(1_800_000_000_000), randomBytes: (n: number) => new Uint8Array(n).fill(7) };

describe("createRpContext", () => {
  it("is deterministic with injected time and randomness and carries a 5 minute expiry", async () => {
    const a = await createRpContext(base);
    expect(await createRpContext(base)).toEqual(a);
    expect(a).toMatchObject({ rp_id: "rp_123", created_at: 1_800_000_000, expires_at: 1_800_000_300 });
    expect(hexToBytes(a.nonce)).toHaveLength(32);
    expect(hexToBytes(a.nonce)[0]).toBe(0);
    expect(hexToBytes(a.signature)).toHaveLength(65);
  });
  it("is signed by the RP key over the documented message, and the action is bound", async () => {
    const a = await createRpContext(base);
    const b = await createRpContext({ ...base, action: "other" });
    expect(a.signature).not.toBe(b.signature);
    const h = (s: string) => hexToBytes(keccak256(stringToBytes(s)));
    void h;
    const msg = concat([new Uint8Array([1]), hexToBytes(a.nonce), numberToBytes(a.created_at, { size: 8 }), numberToBytes(a.expires_at, { size: 8 }), concat([new Uint8Array(1), hexToBytes(keccak256(stringToBytes("enrol-business"))).slice(0, 31)])]);
    expect(await recoverMessageAddress({ message: { raw: msg }, signature: a.signature })).toBe(privateKeyToAccount(KEY).address);
  });
  it("refuses a malformed key (e.g. the address that was once pasted by mistake)", async () => {
    await expect(createRpContext({ ...base, signingKey: "0x104C000000000000000000000000000000003f3E" })).rejects.toThrow();
  });
  it("different nonces per call by default", async () => {
    const { randomBytes, ...rest } = base;
    void randomBytes;
    expect((await createRpContext(rest)).nonce).not.toBe((await createRpContext(rest)).nonce);
  });
});

// Written from World's published idkit-server 1.2.0 source (read, not executed): an independent rebuild of the signed
// message with plain BigInt/DataView code, so a mistake in rp.ts cannot be mirrored here.
import { keccak256 as k256, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount as account } from "viem/accounts";
import { createRpContext as make } from "../../src/world/rp";
import { expect as ex, it as t } from "vitest";

const hashToFieldRef = (input: Uint8Array): Uint8Array => {
  const v = BigInt(k256(input)) >> 8n;
  return Uint8Array.from(Buffer.from(v.toString(16).padStart(64, "0"), "hex"));
};
const layoutRef = (nonce: Uint8Array, created: number, expires: number, action: string): Uint8Array => {
  const a = hashToFieldRef(toBytes(action));
  const m = new Uint8Array(49 + a.length);
  m[0] = 1;
  m.set(nonce, 1);
  const view = new DataView(m.buffer);
  view.setBigUint64(33, BigInt(created), false);
  view.setBigUint64(41, BigInt(expires), false);
  m.set(a, 49);
  return m;
};

t("the signature verifies against World's message layout, and only for the action it was made for", async () => {
  const key = generatePrivateKey();
  const ctx = await make({ rpId: "rp_test", action: "enrol-business", signingKey: key });
  const nonce = Uint8Array.from(Buffer.from(ctx.nonce.slice(2), "hex"));
  const signer = account(key).address;
  ex(await recoverMessageAddress({ message: { raw: layoutRef(nonce, ctx.created_at, ctx.expires_at, "enrol-business") }, signature: ctx.signature })).toBe(signer);
  ex(await recoverMessageAddress({ message: { raw: layoutRef(nonce, ctx.created_at, ctx.expires_at, "other-action") }, signature: ctx.signature })).not.toBe(signer);
});
