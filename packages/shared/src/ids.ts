import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

/** ref = keccak256(utf8(invoice number)). The contract takes the 32-byte ref, not the string. */
export function invoiceRef(number: string): Hex {
  return keccak256(toBytes(number));
}

/** PaymentRouter.invoiceIdOf: keccak256(abi.encode(merchant, ref)). Merchant-scoped, so ids cannot be squatted. */
export function invoiceId(merchant: Address, number: string): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [merchant, invoiceRef(number)]),
  );
}

/** PaymentRouter.payNonce: the only EIP-3009 nonce `pay` accepts for this invoice and salt. */
export function payNonce(id: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "bytes32" }],
      ["STENMONT_PAY", id, salt],
    ),
  );
}

/** PaymentRouter.refundNonce: the only EIP-3009 nonce `refund` accepts for this invoice, recipient and salt. */
export function refundNonce(id: Hex, to: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
      ["STENMONT_REFUND", id, to, salt],
    ),
  );
}
