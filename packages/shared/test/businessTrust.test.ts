import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { businessTrustData, verifyBusinessTrust } from "../src/businessTrust";
const account = privateKeyToAccount(`0x${"42".repeat(32)}`);
const claims = { merchantId: "m1", environment: "staging", ensName: "acme.stenmont.eth", domain: "acme.example", payout: "0x1111111111111111111111111111111111111111", worldVerifiedAt: "2026-11-06T10:00:00Z", issuedAt: "1000", expiresAt: "1300" };
describe("signed business fact observations", () => {
  it("accepts a valid short-lived attestation only from the caller's trusted signer", async () => {
    const signature = await account.signTypedData(businessTrustData(claims));
    expect(await verifyBusinessTrust({ claims, signature }, { signer: account.address, ensName: claims.ensName, environment: "staging", now: 1100 })).toBe(true);
    expect(await verifyBusinessTrust({ claims, signature }, { signer: "0x2222222222222222222222222222222222222222", ensName: claims.ensName, environment: "staging", now: 1100 })).toBe(false);
  });
  it("refuses tampering, expired, future, wrong name/environment and oversized lifetimes", async () => {
    const signature = await account.signTypedData(businessTrustData(claims));
    const expected = { signer: account.address, ensName: claims.ensName, environment: "staging", now: 1100 };
    for (const change of [{ domain: "evil.example" }, { environment: "production" }, { ensName: "evil.eth" }, { expiresAt: "99999" }]) expect(await verifyBusinessTrust({ claims: { ...claims, ...change }, signature }, expected)).toBe(false);
    for (const now of [999, 1300, 1500]) expect(await verifyBusinessTrust({ claims, signature }, { ...expected, now })).toBe(false);
  });
});
