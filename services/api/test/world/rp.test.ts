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
