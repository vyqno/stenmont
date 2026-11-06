import { encodeAbiParameters, keccak256, isAddress, zeroAddress, type Address, type Hex } from "viem";

import { payNonce } from "../ids";

export function payNonceV2(invoiceId: Hex, payout: Address, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }], ["STENMONT_PAY_V2", invoiceId, payout, salt]));
}
export const routerV2Domain = (verifyingContract: Address) => ({ name: "Stenmont PaymentRouter", version: "2", chainId: 1874, verifyingContract }) as const;
export const invoiceClaimV2Domain = (verifyingContract: Address) => ({ name: "Stenmont InvoiceClaim", version: "2", chainId: 1874, verifyingContract }) as const;
export const invoiceAckDomain = (verifyingContract: Address) => ({ name: "Stenmont InvoiceAck", version: "1", chainId: 1874, verifyingContract }) as const;
export const invoiceAckTypes = { InvoiceAck: [
  { name: "invoiceId", type: "bytes32" }, { name: "amount", type: "uint128" },
  { name: "dueDate", type: "uint64" }, { name: "buyer", type: "address" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] } as const;

export function paymentNonce(a: { contractVersion?: string; invoiceId: Hex; payout?: Address; salt: Hex }): Hex {
  if (!a.contractVersion || a.contractVersion === "v1") return payNonce(a.invoiceId, a.salt);
  if (a.contractVersion !== "v2" || !a.payout || !isAddress(a.payout) || a.payout.toLowerCase() === zeroAddress) throw new Error("invalid_authorization");
  return payNonceV2(a.invoiceId, a.payout, a.salt);
}
