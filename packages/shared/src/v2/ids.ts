import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
/** Isolated v2 payment nonce. Never use with the active v1 router. */
export function payNonceV2(id: Hex, payout: Address, salt: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{type:"string"},{type:"bytes32"},{type:"address"},{type:"bytes32"}],
    ["STENMONT_PAY_V2",id,payout,salt],
  ));
}
