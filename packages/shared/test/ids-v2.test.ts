import { describe, expect, it } from "vitest";
import { payNonceV2 } from "../src/v2/ids";
import { payNonce } from "../src/ids";
describe("isolated v2 payment nonce", () => {
  it("matches independent cast abi-encode/keccak vector and differs from v1", () => {
    const id = "0x9ef5cc50eed76dda0d467227d32f719840fdc30d278ccee49088083624704f1b";
    const payout = "0xe4F5853650f40f04e920c62F6dE9e4e38D767B66";
    const salt = "0xad7b6b88034155f1e86d31a54d7723ede2183a6538ecab39ce7a7144ff280fcd";
    expect(payNonceV2(id,payout,salt)).toBe("0xbd89afbf3fe55dac91f778279a9d95336f1cb4be32c48a4923ab63ad829602f6");
    expect(payNonceV2(id,payout,salt)).not.toBe(payNonce(id,salt));
    expect(payNonceV2(id,"0x0000000000000000000000000000000000000001",salt)).not.toBe(payNonceV2(id,payout,salt));
  });
});
