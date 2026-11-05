import type { Address, Hex, TypedDataDomain } from "viem";
import { USDT_ADDRESS } from "./chains";

export const usdtDomain = {
  name: "Tether USD",
  version: "1",
  chainId: 1874,
  verifyingContract: USDT_ADDRESS,
} as const satisfies TypedDataDomain;

export const receiveAuthTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function buildReceiveAuth(args: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: usdtDomain,
    types: receiveAuthTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message: args,
  };
}

/** Field order must match PaymentRouter.CREATE_INVOICE_TYPEHASH exactly (a test pins it to the deployed contract). */
export const createInvoiceTypes = {
  CreateInvoice: [
    { name: "merchant", type: "address" },
    { name: "ref", type: "bytes32" },
    { name: "payout", type: "address" },
    { name: "payerLock", type: "address" },
    { name: "amount", type: "uint128" },
    { name: "minPayment", type: "uint128" },
    { name: "dueDate", type: "uint64" },
    { name: "metaHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function routerDomain(verifyingContract: Address) {
  return {
    name: "Stenmont PaymentRouter",
    version: "1",
    chainId: 1874,
    verifyingContract,
  } as const satisfies TypedDataDomain;
}

/** Merchant delegates invoice creation to a creator (the relayer). Pinned to the deployed typehash by a test. */
export const setCreatorTypes = {
  SetCreator: [
    { name: "merchant", type: "address" },
    { name: "creator", type: "address" },
    { name: "allowed", type: "bool" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
