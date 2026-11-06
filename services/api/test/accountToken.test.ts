import { describe, expect, it } from "vitest";
import { ACCOUNT_LINK_DAYS, signAccountToken, verifyAccountToken } from "../src/account/token";

const SECRET = "s".repeat(32);
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-11-06T12:00:00Z");
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe("account link tokens", () => {
  it("round-trips for the payer it was made for, whatever the address case", async () => {
    const token = await signAccountToken(SECRET, "0xAbCdEf0123456789aBcDEf0123456789abcdef01", "receipts", NOW);
    expect(await verifyAccountToken(SECRET, token, "receipts", later(1))).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });

  it("expires after seven days", async () => {
    expect(ACCOUNT_LINK_DAYS).toBe(7);
    const token = await signAccountToken(SECRET, A, "receipts", NOW);
    expect(await verifyAccountToken(SECRET, token, "receipts", later(6.99))).toBe(A);
    expect(await verifyAccountToken(SECRET, token, "receipts", later(7.01))).toBeNull();
  });

  it("is bound to its purpose", async () => {
    const token = await signAccountToken(SECRET, A, "receipts", NOW);
    expect(await verifyAccountToken(SECRET, token, "other", NOW)).toBeNull();
  });

  it("rejects another secret, a swapped payer, a stretched expiry and any edit", async () => {
    const token = await signAccountToken(SECRET, A, "receipts", NOW);
    expect(await verifyAccountToken("t".repeat(32), token, "receipts", NOW)).toBeNull();
    const [v, , purpose, exp, mac] = token.split(".");
    expect(await verifyAccountToken(SECRET, [v, B.slice(2), purpose, exp, mac].join("."), "receipts", NOW)).toBeNull();
    expect(await verifyAccountToken(SECRET, [v, A.slice(2), purpose, String(Number(exp) + 86_400 * 30), mac].join("."), "receipts", NOW)).toBeNull();
    expect(await verifyAccountToken(SECRET, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), "receipts", NOW)).toBeNull();
  });

  it("rejects junk without throwing", async () => {
    for (const junk of ["", "x", "v1.a.b.c.d", "v1....", "v2." + "a".repeat(40) + ".receipts.9999999999.AAAA", "a".repeat(5000), "v1.zz.receipts.1.@@@"]) {
      expect(await verifyAccountToken(SECRET, junk, "receipts", NOW)).toBeNull();
    }
  });

  it("refuses to sign with a short or missing secret", async () => {
    await expect(signAccountToken("short", A, "receipts", NOW)).rejects.toThrow();
    expect(await verifyAccountToken("", "v1.x", "receipts", NOW)).toBeNull();
  });
});
