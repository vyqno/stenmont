import { describe, expect, it } from "vitest";
import { cancelDigest, describePeriod, permitDigest, planCopy, subscribeDigest, type Terms } from "../lib/subscribe";

const MANAGER = "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD";
const PAYER = "0x2222222222222222222222222222222222222222";
const terms: Terms = {
  id: `0x${"ab".repeat(32)}`,
  status: "offered",
  merchantName: "Acme",
  merchantAddress: "0x50c94c3021962047F10c9c58D80C4A7b73182a63",
  payout: "0x1111111111111111111111111111111111111111",
  amount: "9.99",
  periodSeconds: 2_592_000,
  maxCharges: 12,
  startAt: 1_790_000_000,
  manager: MANAGER,
};

describe("subscription digests", () => {
  it("are 32-byte hashes that change when any term changes (so the signer cannot be tricked into other terms)", () => {
    const base = subscribeDigest(terms, PAYER, 1_790_003_600n);
    expect(base).toMatch(/^0x[0-9a-f]{64}$/);
    const variants = [
      { ...terms, amount: "10.00" },
      { ...terms, maxCharges: 13 },
      { ...terms, periodSeconds: 60 },
      { ...terms, payout: "0x3333333333333333333333333333333333333333" as const },
      { ...terms, startAt: 1 },
    ];
    for (const v of variants) expect(subscribeDigest(v, PAYER, 1_790_003_600n)).not.toBe(base);
    expect(subscribeDigest(terms, PAYER, 1_790_003_601n)).not.toBe(base);
    expect(subscribeDigest(terms, "0x4444444444444444444444444444444444444444", 1_790_003_600n)).not.toBe(base);
  });
  it("permit covers every charge the agreement allows, on top of what is already approved", () => {
    const a = permitDigest(terms, PAYER, { allowance: "0", nonce: 0n, deadline: 1n });
    expect(a).not.toBe(permitDigest(terms, PAYER, { allowance: "5", nonce: 0n, deadline: 1n }));
    expect(a).not.toBe(permitDigest(terms, PAYER, { allowance: "0", nonce: 1n, deadline: 1n }));
  });
  it("cancel binds the subscription and a deadline", () => {
    expect(cancelDigest(terms, 100n)).not.toBe(cancelDigest(terms, 101n));
    expect(cancelDigest(terms, 100n)).not.toBe(cancelDigest({ ...terms, id: `0x${"cd".repeat(32)}` }, 100n));
  });
  it("describes the schedule in plain words", () => {
    expect(describePeriod(2_592_000)).toBe("30 days");
    expect(describePeriod(86_400)).toBe("day");
    expect(describePeriod(604_800)).toBe("7 days");
    expect(describePeriod(3_600)).toBe("hour");
    expect(describePeriod(60)).toBe("minute");
    expect(describePeriod(300)).toBe("5 minutes");
  });
});

describe("plan copy", () => {
  const plan: Terms = { ...terms, kind: "instalment", amount: "33.333333", maxCharges: 3, total: "100", payerBusinessName: "Globex Ltd" };
  it("tells a buyer what a pay-in-3 plan will take, in plain words", () => {
    const c = planCopy(plan);
    expect(c.title).toBe("Pay Acme in 3 parts");
    expect(c.schedule).toBe("3 payments of $33.333333, one every 30 days. The first is taken now.");
    expect(c.total).toBe("Total $100.00");
    expect(c.forBusiness).toBe("A payment plan for Globex Ltd. Business purchases only.");
    expect(c.button).toBe("Start paying in 3 parts");
    expect(c.visibility).toMatch(/can see whether each payment will go through/);
  });
  it("keeps the subscription wording for a subscription", () => {
    const c = planCopy(terms);
    expect(c.title).toBe("Subscribe to Acme");
    expect(c.schedule).toBe("every 30 days, up to 12 payments");
    expect(c.forBusiness).toBeNull();
  });
  it("never uses crypto words", () => {
    const text = JSON.stringify([planCopy(plan), planCopy(terms)]);
    expect(text).not.toMatch(/\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|permit|allowance)\b/i);
  });
});
