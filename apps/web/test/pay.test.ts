import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { buildReceiveAuth, deployments, payNonce } from "@stenmont/shared";
import { FRIENDLY, ZERO_SALT, apiBase, b64urlDecode, b64urlEncode, formatAmount, friendly, isTestEnvironment, payChallenge, payViewKind, routerFor } from "../lib/pay";

const BANNED = /\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;

describe("hosts", () => {
  it("maps each app host to its own API", () => {
    expect(apiBase("testnet.stenmont.com")).toBe("https://api-testnet.stenmont.com");
    expect(apiBase("app-staging.stenmont.com")).toBe("https://api-staging.stenmont.com");
    expect(apiBase("app.stenmont.com")).toBe("https://api.stenmont.com");
    expect(apiBase("localhost")).toBe("http://localhost:8787");
    expect(() => apiBase("evil.example")).toThrow();
  });
  it("knows which hosts are test environments", () => {
    expect(isTestEnvironment("testnet.stenmont.com")).toBe(true);
    expect(isTestEnvironment("localhost")).toBe(true);
    expect(isTestEnvironment("app.stenmont.com")).toBe(false);
  });
  it("uses the staging router for staging and local, and refuses production until it exists", () => {
    expect(routerFor("testnet.stenmont.com")).toBe(deployments.environments.staging.PaymentRouter.address);
    expect(routerFor("localhost")).toBe(deployments.environments.staging.PaymentRouter.address);
    expect(() => routerFor("app.stenmont.com")).toThrow();
  });
});

describe("amounts", () => {
  it("shows dollars with two decimals", () => {
    expect(formatAmount("2.5")).toBe("$2.50");
    expect(formatAmount("100")).toBe("$100.00");
    expect(formatAmount("0.000001")).toBe("$0.000001");
  });
});

describe("base64url", () => {
  it("round-trips and has no padding", () => {
    const bytes = Uint8Array.from([251, 255, 254, 0, 1, 2, 3]);
    const s = b64urlEncode(bytes);
    expect(s).toBe("-__-AAECAw");
    expect(Array.from(b64urlDecode(s))).toEqual(Array.from(bytes));
  });
});

describe("what the passkey signs", () => {
  it("is the EIP-712 digest of the authorization bound to this invoice", () => {
    const args = {
      account: "0x2222222222222222222222222222222222222222" as const,
      router: deployments.environments.staging.PaymentRouter.address,
      value: 5_000_000n,
      validBefore: 9_999_999_999n,
      invoiceId: `0x${"ab".repeat(32)}` as const,
      salt: ZERO_SALT,
    };
    const expected = hashTypedData(
      buildReceiveAuth({ from: args.account, to: args.router, value: args.value, validAfter: 0n, validBefore: args.validBefore, nonce: payNonce(args.invoiceId, args.salt) }),
    );
    expect(payChallenge(args)).toBe(expected);
    expect(payChallenge({ ...args, invoiceId: `0x${"cd".repeat(32)}` })).not.toBe(expected); // a different invoice, a different digest
  });
});

describe("customer-facing copy", () => {
  it("never uses crypto words, for every error the API can return", () => {
    for (const msg of Object.values(FRIENDLY)) expect(msg).not.toMatch(BANNED);
    expect(friendly("something_unknown")).not.toMatch(BANNED);
    expect(friendly("something_unknown")).toMatch(/try again/i);
  });
  it("covers every relay error code", () => {
    const codes = ["rate_limited", "invoice_not_found", "invoice_not_payable", "gas_tank_empty", "gas_cap_reached", "payer_cap", "busy", "duplicate", "account_mismatch", "overpay", "below_minimum", "wrong_payer", "invalid_authorization", "relayer_low", "chain_error", "tx_reverted", "timeout"];
    for (const c of codes) expect(FRIENDLY[c], c).toBeTruthy();
  });
});

describe("what the pay page shows", () => {
  it("shows a paused business as temporarily unavailable, not as a missing invoice", () => {
    expect(payViewKind({ status: "open", paused: true })).toBe("paused");
    expect(payViewKind({ status: "partially_paid", paused: true })).toBe("paused");
  });
  it("keeps the other states as they were", () => {
    expect(payViewKind({ status: "open", paused: false })).toBe("ready");
    expect(payViewKind({ status: "open" })).toBe("ready");
    expect(payViewKind({ status: "paid", paused: true })).toBe("paid");
    expect(payViewKind({ status: "cancelled" })).toBe("missing");
  });
  it("tells the customer in plain words", () => {
    expect(friendly("payments_paused")).toMatch(/paused/);
    expect(friendly("payments_paused")).not.toMatch(BANNED);
  });
});
