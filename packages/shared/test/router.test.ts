import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { paymentRouterAbi } from "../src/abis";
import { deployments } from "../src/addresses";
import { createInvoiceTypes, routerDomain, setCreatorTypes } from "../src/eip712";

// Read from the deployed, verified contract: cast call <router> "CREATE_INVOICE_TYPEHASH()(bytes32)"
const ON_CHAIN_CREATE_INVOICE_TYPEHASH = "0x3961e9f03a74a0d88616d51ef404f2e05c94b935f7f840de56a3306286f41d37";

describe("PaymentRouter typed data", () => {
  it("createInvoiceTypes hashes to the deployed contract's typehash", () => {
    const encoded = `CreateInvoice(${createInvoiceTypes.CreateInvoice.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(keccak256(toBytes(encoded))).toBe(ON_CHAIN_CREATE_INVOICE_TYPEHASH);
  });
  it("setCreatorTypes hashes to the deployed contract's typehash", () => {
    const encoded = `SetCreator(${setCreatorTypes.SetCreator.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(keccak256(toBytes(encoded))).toBe("0x5ef2a5f1caf936970397bd487d7c676e89110a0540426362c40cb524a51202eb");
  });
  it("routerDomain names the contract and chain", () => {
    const d = routerDomain("0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929");
    expect(d).toEqual({
      name: "Stenmont PaymentRouter",
      version: "1",
      chainId: 1874,
      verifyingContract: "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929",
    });
  });
});

describe("generated artifacts", () => {
  it("ABI exposes the router's public surface", () => {
    const names = paymentRouterAbi.filter((x) => x.type === "function").map((x) => x.name);
    for (const fn of ["createInvoice", "pay", "refund", "refundWithApproval", "cancel", "setHook", "setCreator", "payNonce"]) {
      expect(names).toContain(fn);
    }
  });
  it("staging deployment is recorded and verified", () => {
    const r = deployments.environments.staging.PaymentRouter;
    expect(r.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.verified).toBe(true);
    expect(deployments.chainId).toBe(1874);
  });
});
