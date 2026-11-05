import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { passkeyAccountAbi, passkeyAccountFactoryAbi, paymentRouterAbi, subscriptionManagerAbi } from "../src/abis";
import { deployments } from "../src/addresses";
import { cancelSubscriptionTypes, createInvoiceTypes, routerDomain, setCreatorTypes, subscribeTypes, subscriptionDomain } from "../src/eip712";

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
  it("subscribeTypes and cancelSubscriptionTypes hash to the deployed contract's typehashes", () => {
    const enc = (name: string, f: readonly { name: string; type: string }[]) => keccak256(toBytes(`${name}(${f.map((x) => `${x.type} ${x.name}`).join(",")})`));
    expect(enc("Subscribe", subscribeTypes.Subscribe)).toBe("0xc6353b725d355bdfa70730a1f31b82d19e653d34277f558bd6853b60945d5be4");
    expect(enc("CancelSubscription", cancelSubscriptionTypes.CancelSubscription)).toBe("0xe5f9a55575630cd7c2c6015335cbc7dc4d65d86041589ecd62f93ba618825a98");
    expect(subscriptionDomain("0x3e1C51d461e6adb0b087DC39d41942E084eba2DD")).toEqual({
      name: "Stenmont SubscriptionManager",
      version: "1",
      chainId: 1874,
      verifyingContract: "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD",
    });
  });
  it("subscription manager ABI and deployment are recorded", () => {
    const names = subscriptionManagerAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["subscribe", "charge", "cancel", "cancelWithSig", "isDue"]));
    expect(deployments.environments.staging.SubscriptionManager.verified).toBe(true);
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
  it("passkey ABIs expose the factory and the ERC-1271 check", () => {
    const factory = passkeyAccountFactoryAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(factory).toEqual(expect.arrayContaining(["createAccount", "getAddress", "implementation"]));
    const account = passkeyAccountAbi.filter((x) => x.type === "function").map((x) => x.name);
    expect(account).toEqual(expect.arrayContaining(["isValidSignature", "initialize", "signer"]));
  });
  it("passkey factory deployment is recorded and verified", () => {
    const f = deployments.environments.staging.PasskeyAccountFactory;
    expect(f.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(f.implementation).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(f.verified).toBe(true);
  });
  it("staging deployment is recorded and verified", () => {
    const r = deployments.environments.staging.PaymentRouter;
    expect(r.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.verified).toBe(true);
    expect(deployments.chainId).toBe(1874);
  });
});
