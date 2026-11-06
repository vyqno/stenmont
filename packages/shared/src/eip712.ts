import { encodeAbiParameters, keccak256, type Address, type Hex, type TypedDataDomain } from "viem";
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

/** The attester's approval of one large refund (PaymentRouter.refundWithApproval). */
export const refundApprovalTypes = {
  RefundApproval: [
    { name: "opHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** keccak256(abi.encode(id, value, to, salt)): what the approval is bound to, so it cannot authorise another refund. */
export function refundOpHash(id: Hex, value: bigint, to: Address, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint128" }, { type: "address" }, { type: "bytes32" }], [id, value, to, salt]));
}

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

export const transferAuthTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function buildTransferAuth(args: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}) {
  return {
    domain: usdtDomain,
    types: transferAuthTypes,
    primaryType: "TransferWithAuthorization" as const,
    message: args,
  };
}

/** Field order must match SubscriptionManager.SUBSCRIBE_TYPEHASH (a test pins it to the deployed contract). */
export const subscribeTypes = {
  Subscribe: [
    { name: "id", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "payout", type: "address" },
    { name: "amount", type: "uint128" },
    { name: "periodSeconds", type: "uint32" },
    { name: "startAt", type: "uint64" },
    { name: "maxCharges", type: "uint32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const cancelSubscriptionTypes = {
  CancelSubscription: [
    { name: "id", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function subscriptionDomain(verifyingContract: Address) {
  return { name: "Stenmont SubscriptionManager", version: "1", chainId: 1874, verifyingContract } as const satisfies TypedDataDomain;
}

/** EIP-2612 permit on the USDT token. A permit SETS the allowance (it does not add), so sign "current allowance + this cap". */
export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function buildPermit(args: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint }) {
  return { domain: usdtDomain, types: permitTypes, primaryType: "Permit" as const, message: args };
}
