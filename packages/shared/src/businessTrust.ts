import { isAddress, verifyTypedData, type Address, type Hex } from "viem";
/** A signed observation of named facts, not a guarantee of safety, KYC or future control. */
export type BusinessTrustClaims = { merchantId: string; environment: string; ensName: string; domain: string; payout: string; worldVerifiedAt: string; issuedAt: string; expiresAt: string };
export type BusinessTrustAttestation = { claims: BusinessTrustClaims; signature: Hex };
export function businessTrustData(c: BusinessTrustClaims) {
  return { domain: { name: "Stenmont business fact observation", version: "1" }, primaryType: "BusinessFacts" as const,
    types: { BusinessFacts: [ { name: "merchantId", type: "string" }, { name: "environment", type: "string" }, { name: "ensName", type: "string" }, { name: "domain", type: "string" }, { name: "payout", type: "string" }, { name: "worldVerifiedAt", type: "string" }, { name: "issuedAt", type: "uint256" }, { name: "expiresAt", type: "uint256" } ] },
    message: { ...c, issuedAt: BigInt(c.issuedAt), expiresAt: BigInt(c.expiresAt) },
  };
}
export async function verifyBusinessTrust(a: BusinessTrustAttestation, expected: { signer: Address; ensName: string; environment: string; now: number }): Promise<boolean> {
  try {
    const c = a.claims;
    if (!c || Object.keys(c).sort().join() !== "domain,ensName,environment,expiresAt,issuedAt,merchantId,payout,worldVerifiedAt" || !Object.values(c).every(v => typeof v === "string" && v.length > 0 && v.length <= 253)) return false;
    if (c.ensName !== expected.ensName || c.environment !== expected.environment || !isAddress(c.payout) || !/^\d{1,12}$/.test(c.issuedAt) || !/^\d{1,12}$/.test(c.expiresAt)) return false;
    const issued = Number(c.issuedAt), expires = Number(c.expiresAt);
    if (!Number.isFinite(expected.now) || issued > expected.now || expires <= expected.now || expires <= issued || expires - issued > 300) return false;
    return await verifyTypedData({ ...businessTrustData(c), address: expected.signer, signature: a.signature });
  } catch { return false; }
}
