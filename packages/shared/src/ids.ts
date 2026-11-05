import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** Deterministic invoice id: keccak256(abi.encode(merchant, number)). */
export function invoiceId(merchant: Address, number: string): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "string" }], [merchant, number]),
  );
}
