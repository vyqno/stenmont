import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyFreshInvoice } from "../lib/v2Chain";
const router = "0x2222222222222222222222222222222222222222" as const;
const payout = "0x3333333333333333333333333333333333333333" as const;
const buyer = "0x4444444444444444444444444444444444444444" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const inv = { id: `0x${"12".repeat(32)}`, contractVersion: "v2", routerAddress: router, payout, payerLock: buyer, amount: "100", amountPaid: "0", remaining: "100", discountBps: 200, discountUntil: 2000, hook: zero, dueDate: "2030-01-01T00:00:00.000Z", payeeName: null };
const state = { payout, payerLock: buyer, amount: 100_000_000n, paid: 0n, status: 1, discountBps: 200, discountUntil: 2000n, hook: zero, dueDate: 1893456000n };
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_ROUTER_V2_ADDRESS", router));
describe("independent trusted-router invoice read", () => {
  it("rejects API router substitution before any RPC or signing", async () => {
    const read = vi.fn(async () => state);
    await expect(verifyFreshInvoice({ ...inv, routerAddress: buyer }, { read })).rejects.toThrow("invalid_authorization");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects an API payout substitution against the direct trusted-router read", async () => {
    await expect(verifyFreshInvoice({ ...inv, payout: buyer }, { read: async () => state })).rejects.toThrow("invalid_authorization");
  });
  it("fails closed without a reviewed build binding and refuses changed buyer or discount terms", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROUTER_V2_ADDRESS", "");
    await expect(verifyFreshInvoice(inv, { read: async () => state })).rejects.toThrow();
    vi.stubEnv("NEXT_PUBLIC_ROUTER_V2_ADDRESS", router);
    await expect(verifyFreshInvoice({ ...inv, payerLock: payout }, { read: async () => state })).rejects.toThrow();
    await expect(verifyFreshInvoice({ ...inv, discountUntil: 2001 }, { read: async () => state })).rejects.toThrow();
  });
  it("refreshes a newly attached hook before payment prompts rather than using cached routing", async () => {
    const got = await verifyFreshInvoice({ ...inv, discountBps: 0, discountUntil: 0 }, { read: async () => ({ ...state, discountBps: 0, discountUntil: 0n, hook: buyer }) });
    expect(got.invoice.hook).toBe(buyer);
    expect(got.reviewRequired).toBe(true);
  });
  it("uses fresh received value and independently compares an available ENS address", async () => {
    const got = await verifyFreshInvoice(inv, { read: async () => ({ ...state, paid: 1_000_000n }) });
    expect(got.invoice.amountPaid).toBe("1");
    expect(got.invoice.remaining).toBe("99");
    expect(got.reviewRequired).toBe(true);
    await expect(verifyFreshInvoice({ ...inv, payeeName: "merchant.stenmont.eth" }, { read: async () => state, resolveName: async () => buyer })).rejects.toThrow();
  });
});
