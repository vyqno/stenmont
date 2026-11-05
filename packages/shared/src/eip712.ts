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
