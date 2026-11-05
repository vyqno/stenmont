import { describe, expect, it } from "vitest";
import { hashDomain } from "viem";
import { keccak256, toBytes } from "viem";
import { buildReceiveAuth, buildTransferAuth, receiveAuthTypes, transferAuthTypes, usdtDomain } from "../src/eip712";
import { USDT_ADDRESS } from "../src/chains";

// Read from the live token on 2026-11-06: cast call USDT "DOMAIN_SEPARATOR()(bytes32)"
const ON_CHAIN_DOMAIN_SEPARATOR =
  "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25";

describe("eip712", () => {
  it("usdtDomain hashes to the on-chain DOMAIN_SEPARATOR", () => {
    const hash = hashDomain({
      domain: { ...usdtDomain, chainId: BigInt(usdtDomain.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    expect(hash).toBe(ON_CHAIN_DOMAIN_SEPARATOR);
  });
  it("buildReceiveAuth targets the USDT domain and ReceiveWithAuthorization", () => {
    const a = buildReceiveAuth({
      from: "0x50c94c3021962047F10c9c58D80C4A7b73182a63",
      to: "0xe4F5853650f40f04e920c62F6dE9e4e38D767B66",
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: 9_999_999_999n,
      nonce: `0x${"11".repeat(32)}`,
    });
    expect(a.primaryType).toBe("ReceiveWithAuthorization");
    expect(a.domain.verifyingContract).toBe(USDT_ADDRESS);
    expect(a.message.value).toBe(1_000_000n);
  });
});

describe("USDT authorization typehashes match the live token", () => {
  const encode = (name: string, fields: readonly { name: string; type: string }[]) =>
    keccak256(toBytes(`${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`));
  it("ReceiveWithAuthorization", () => {
    expect(encode("ReceiveWithAuthorization", receiveAuthTypes.ReceiveWithAuthorization)).toBe("0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8");
  });
  it("TransferWithAuthorization", () => {
    expect(encode("TransferWithAuthorization", transferAuthTypes.TransferWithAuthorization)).toBe("0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267");
  });
  it("buildTransferAuth targets the USDT domain", () => {
    const a = buildTransferAuth({
      from: "0x50c94c3021962047F10c9c58D80C4A7b73182a63",
      to: "0xe4F5853650f40f04e920c62F6dE9e4e38D767B66",
      value: 5_000_000n,
      validAfter: 0n,
      validBefore: 9_999_999_999n,
      nonce: `0x${"22".repeat(32)}`,
    });
    expect(a.primaryType).toBe("TransferWithAuthorization");
    expect(a.message.value).toBe(5_000_000n);
  });
});
