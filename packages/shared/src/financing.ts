import { encodeAbiParameters, keccak256, type Address, type Hex, type TypedDataDomain } from "viem";

/** InvoiceClaim.TERMS_TYPEHASH: what the merchant signs to offer an invoice for sale. */
export const claimTermsTypes = {
  ClaimTerms: [
    { name: "invoiceId", type: "bytes32" },
    { name: "discountBps", type: "uint16" },
    { name: "reserveBps", type: "uint16" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** PaymentRouter.SET_HOOK_TYPEHASH (signed with the router's domain): sends this invoice's payments to the claim contract. */
export const setHookTypes = {
  SetHook: [
    { name: "id", type: "bytes32" },
    { name: "hook", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** InvestorRegistry.ALLOW_TYPEHASH: the attester's signature after a World proof was verified. */
export const allowInvestorTypes = {
  AllowInvestor: [
    { name: "investor", type: "address" },
    { name: "expiresAt", type: "uint64" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const claimDomain = (verifyingContract: Address) =>
  ({ name: "Stenmont InvoiceClaim", version: "1", chainId: 1874, verifyingContract }) as const satisfies TypedDataDomain;

export const investorRegistryDomain = (verifyingContract: Address) =>
  ({ name: "Stenmont InvestorRegistry", version: "1", chainId: 1874, verifyingContract }) as const satisfies TypedDataDomain;

/** InvoiceClaim.fundNonce: the only EIP-3009 nonce `fund` accepts for this invoice and salt. */
export function fundNonce(id: Hex, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }, { type: "bytes32" }], ["STENMONT_FUND", id, salt]));
}

/** InvoiceClaim.quote: both round down. */
export function quoteClaim(face: bigint, discountBps: number, reserveBps: number): { price: bigint; reserve: bigint } {
  return { price: (face * BigInt(10_000 - discountBps)) / 10_000n, reserve: (face * BigInt(reserveBps)) / 10_000n };
}

/** Limits the API enforces before asking for a signature (the contract only requires discount < 100% and discount + reserve <= 100%). */
export const CLAIM_LIMITS = { maxDiscountBps: 3_000, maxReserveBps: 5_000, listingDays: 7, graceSeconds: 7 * 86_400 } as const;
