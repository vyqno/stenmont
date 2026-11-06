import { hashDomain, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { deployments } from "../src/addresses";
import { allowInvestorTypes, claimDomain, claimTermsTypes, setHookTypes } from "../src/financing";

// Read from the deployed staging contracts on 2026-11-06 (cast call ... TERMS_TYPEHASH() etc.).
const ON_CHAIN = {
  claimTerms: "0x483d6f2c8a734e4119e5ac977c920a04b5c6cf93c6a50f117466985721387874",
  allowInvestor: "0xd2ff7bad5873e4202c9e5e9a07048d280f4aa06e1aa8c9ad3cb2a2063b48f3d5",
  setHook: "0x686760d3f06c645d1afdefb8e4ee10ecac98327217a8a9b169d1e59f1d1d42e9",
  claimDomainSeparator: "0x333c6ad124c67a632885eef5cc986083692ae8650b174b884af333cf509adbee",
} as const;
const encode = (name: string, fields: readonly { name: string; type: string }[]) => `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;

describe("financing typed data matches the deployed contracts", () => {
  it("ClaimTerms", () => expect(keccak256(toBytes(encode("ClaimTerms", claimTermsTypes.ClaimTerms)))).toBe(ON_CHAIN.claimTerms));
  it("AllowInvestor", () => expect(keccak256(toBytes(encode("AllowInvestor", allowInvestorTypes.AllowInvestor)))).toBe(ON_CHAIN.allowInvestor));
  it("SetHook", () => expect(keccak256(toBytes(encode("SetHook", setHookTypes.SetHook)))).toBe(ON_CHAIN.setHook));
  it("the InvoiceClaim domain separator", () => {
    expect(hashDomain({ domain: { ...claimDomain(deployments.environments.staging.InvoiceClaim.address as `0x${string}`), chainId: 1874n }, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } })).toBe(ON_CHAIN.claimDomainSeparator);
  });
});
