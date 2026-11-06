import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256 } from "viem";
import { buildReceiveAuth, deployments, payNonce } from "@stenmont/shared";
import { payChallenge, ZERO_SALT } from "../lib/pay";
import { paymentPlan, assertPaymentPayer, paymentNonce } from "../lib/v2Payment";
import { toTypedDataV4 } from "../lib/wallet";

const id = `0x${"12".repeat(32)}` as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const payout = "0x3333333333333333333333333333333333333333" as const;
const buyer = "0x4444444444444444444444444444444444444444" as const;
const invoice = { id, contractVersion: "v2", routerAddress: router, payout, payerLock: buyer, amount: "100", amountPaid: "0", remaining: "100", discountBps: 200, discountUntil: 2000 } as const;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ROUTER_V2_ADDRESS", router));

describe("versioned invoice payment safety", () => {
  it("keeps old invoices on their original nonce and deployed router", () => {
    const plan = paymentPlan({ id, amount: "100", amountPaid: "0", remaining: "100" }, "localhost", 1000);
    expect(plan.router).toBe(deployments.environments.staging.PaymentRouter.address);
    expect(paymentNonce({ invoiceId: id, salt: ZERO_SALT })).toBe(payNonce(id, ZERO_SALT));
  });
  it("binds a v2 nonce to invoice, payout and salt with the contract domain tag", () => {
    const args = { contractVersion: "v2" as const, invoiceId: id, payout, salt: ZERO_SALT };
    expect(paymentNonce(args)).toBe(keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }], ["STENMONT_PAY_V2", id, payout, ZERO_SALT])));
    expect(paymentNonce({ ...args, payout: buyer })).not.toBe(paymentNonce(args));
    expect(() => paymentNonce({ ...args, payout: undefined })).toThrow();
  });
  it("includes the deadline second and ends authorization exactly one second later", () => {
    expect(paymentPlan(invoice, "localhost", 1999)).toMatchObject({ value: "98", validBefore: 2001n, discounted: true });
    expect(paymentPlan(invoice, "localhost", 2000)).toMatchObject({ value: "98", validBefore: 2001n, discounted: true });
    expect(paymentPlan(invoice, "localhost", 2001)).toMatchObject({ value: "100", discounted: false });
  });
  it("rounds waived value down and never discounts an already partial invoice", () => {
    expect(paymentPlan({ ...invoice, amount: "0.000001", remaining: "0.000001" }, "localhost", 1000).value).toBe("0.000001");
    expect(paymentPlan({ ...invoice, amountPaid: "1", remaining: "99" }, "localhost", 1000)).toMatchObject({ value: "99", discounted: false });
  });
  it("refuses unknown versions, unlocked discount offers and missing payout/router provenance", () => {
    for (const overrides of [{ contractVersion: "v3" }, { payout: undefined }, { routerAddress: undefined }, { payerLock: null }, { routerAddress: deployments.environments.staging.PaymentRouter.address }]) {
      expect(() => paymentPlan({ ...invoice, ...overrides }, "localhost", 1000)).toThrow();
    }
  });
  it("refuses a different payer before asking for money approval", () => {
    expect(() => assertPaymentPayer(invoice, payout)).toThrow("wrong_payer");
    expect(() => assertPaymentPayer(invoice, buyer)).not.toThrow();
  });
  it("makes passkey and wallet sign the same payout-bound bounded authorization", () => {
    const plan = paymentPlan(invoice, "localhost", 1000);
    const args = { account: buyer, router: plan.router, value: 98_000_000n, validBefore: plan.validBefore, invoiceId: id, salt: ZERO_SALT, contractVersion: "v2" as const, payout };
    const typed = JSON.parse(toTypedDataV4(args));
    delete typed.types.EIP712Domain;
    expect(payChallenge(args)).toBe(hashTypedData(typed));
    expect(payChallenge(args)).toBe(hashTypedData(buildReceiveAuth({ from: buyer, to: router, value: 98_000_000n, validAfter: 0n, validBefore: 2001n, nonce: paymentNonce(args) })));
  });
});

it("does not let an expired discounted authorization become a partial payment", async () => {
  const { assertPaymentFresh } = await import("../lib/v2Payment");
  const plan = paymentPlan(invoice, "localhost", 2000);
  expect(() => assertPaymentFresh(plan, 2000)).not.toThrow();
  expect(() => assertPaymentFresh(plan, 2001)).toThrow("discount_expired");
});
it("refuses a mismatched wallet account before any signing request", async () => {
  const { signWalletPayment, WalletError } = await import("../lib/wallet");
  const methods: string[] = [];
  const provider = { async request({ method }: { method: string }) { methods.push(method); if (method === "eth_requestAccounts") return [payout]; if (method === "eth_chainId") return "0x752"; throw new Error("unexpected signing"); } };
  await expect(signWalletPayment(provider, { router, value: 98_000_000n, validBefore: 2001n, invoiceId: id, salt: ZERO_SALT, contractVersion: "v2", payout }, async who => { try { assertPaymentPayer(invoice, who); } catch { throw new WalletError("wrong_payer"); } })).rejects.toThrow("wrong_payer");
  expect(methods).not.toContain("eth_signTypedData_v4");
});

it("shows actual received value after reloading a discounted paid invoice", async () => {
  const { paymentReceiptAmount } = await import("../lib/v2Payment");
  expect(paymentReceiptAmount({ amountPaid: "98", remaining: "0" })).toBe("98");
  expect(paymentReceiptAmount({ amountPaid: "0", remaining: "98" })).toBe("98");
});

it("keeps the reviewed retired v1 router payable but refuses arbitrary legacy addresses", () => {
  const legacy = { id, amount: "100", amountPaid: "0", remaining: "100", contractVersion: "v1", routerAddress: "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929" };
  expect(paymentPlan(legacy, "localhost", 1000).router).toBe(legacy.routerAddress);
  expect(() => paymentPlan({ ...legacy, routerAddress: buyer }, "localhost", 1000)).toThrow();
});
