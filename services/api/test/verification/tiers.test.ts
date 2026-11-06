import { describe, expect, it } from "vitest";
import { toUnits } from "@stenmont/shared";
import { DEMO_LIMITS, checkFinancing, checkInvestor, checkInvoice, computeTier, nextStepFor, resolveLimits, type Facts, type VerificationFact } from "../../src/verification/tiers";

const NOW = new Date("2026-11-06T12:00:00Z");
const rec = (method: string, over: Partial<VerificationFact> = {}): VerificationFact => ({ tier: 1, method, decision: "approved", decidedAt: "2026-11-01T00:00:00Z", expiresAt: null, ...over });
const facts = (over: Partial<Facts> = {}): Facts => ({ records: [], domainVerified: false, worldEnrolled: false, ...over });
const USDT = (n: number | string) => toUnits(String(n));

describe("computeTier", () => {
  it("is 0 with nothing", () => expect(computeTier(facts(), NOW).tier).toBe(0));
  it("is 1 with an approved email record", () => expect(computeTier(facts({ records: [rec("email")] }), NOW).tier).toBe(1));
  it("is 2 with a verified domain, or an approved domain record", () => {
    expect(computeTier(facts({ domainVerified: true }), NOW).tier).toBe(2);
    expect(computeTier(facts({ records: [rec("domain")] }), NOW).tier).toBe(2);
  });
  it("is 3 with a World enrolment (no email or documents needed)", () => {
    expect(computeTier(facts({ worldEnrolled: true }), NOW).tier).toBe(3);
    expect(computeTier(facts({ records: [rec("world")] }), NOW).tier).toBe(3);
  });
  it("is 4 with an approved KYC decision", () => expect(computeTier(facts({ records: [rec("kyc")] }), NOW).tier).toBe(4));
  it("takes the highest route that holds, not a chain", () => {
    expect(computeTier(facts({ records: [rec("email")], worldEnrolled: true, domainVerified: true }), NOW).tier).toBe(3);
    expect(computeTier(facts({ records: [rec("kyc"), rec("email")], worldEnrolled: true }), NOW).tier).toBe(4);
  });
  it("ignores rejected and pending decisions", () => {
    expect(computeTier(facts({ records: [rec("kyc", { decision: "rejected" })] }), NOW).tier).toBe(0);
    expect(computeTier(facts({ records: [rec("kyc", { decision: "pending" }), rec("email")] }), NOW).tier).toBe(1);
  });
  it("ignores unknown methods (a record cannot claim a tier by itself)", () => {
    expect(computeTier(facts({ records: [rec("magic", { tier: 4 })] }), NOW).tier).toBe(0);
  });
  it("drops back when a record expires: exactly at the expiry instant it no longer counts", () => {
    const kyc = rec("kyc", { expiresAt: "2026-11-06T12:00:00Z" });
    expect(computeTier(facts({ records: [kyc], worldEnrolled: true }), new Date("2026-11-06T11:59:59Z")).tier).toBe(4);
    expect(computeTier(facts({ records: [kyc], worldEnrolled: true }), NOW).tier).toBe(3);
    expect(computeTier(facts({ records: [kyc] }), NOW).tier).toBe(0);
  });
  it("loses tier 2 when the domain check stops passing", () => {
    expect(computeTier(facts({ domainVerified: false, records: [rec("email")] }), NOW).tier).toBe(1);
  });
  it("says which method granted the tier", () => expect(computeTier(facts({ records: [rec("kyc")] }), NOW).via).toBe("kyc"));
});

describe("resolveLimits", () => {
  it("uses the demo defaults when no override rows exist", () => {
    expect(resolveLimits([])).toEqual(DEMO_LIMITS);
  });
  it("lets a stored row replace one tier and leaves the others", () => {
    const l = resolveLimits([{ tier: 1, perInvoice: "7000000", dailyVolume: "9000000", financingCap: "0", investor: 0 }]);
    expect(l[1]!.perInvoice).toBe(7_000_000n);
    expect(l[0]).toEqual(DEMO_LIMITS[0]);
  });
  it("ignores a malformed row instead of opening a gate", () => {
    const l = resolveLimits([{ tier: 2, perInvoice: "not-a-number", dailyVolume: "1", financingCap: "0", investor: 1 }]);
    expect(l[2]).toEqual(DEMO_LIMITS[2]);
    expect(resolveLimits([{ tier: 9, perInvoice: "1", dailyVolume: "1", financingCap: "0", investor: 1 }])).toEqual(DEMO_LIMITS);
  });
  it("demo defaults rise with the tier", () => {
    for (let t = 1; t <= 4; t++) {
      expect(DEMO_LIMITS[t]!.perInvoice).toBeGreaterThan(DEMO_LIMITS[t - 1]!.perInvoice);
      expect(DEMO_LIMITS[t]!.dailyVolume).toBeGreaterThan(DEMO_LIMITS[t - 1]!.dailyVolume);
    }
  });
});

describe("checkInvoice (per-invoice and daily caps)", () => {
  const limits = resolveLimits([]);
  const t0 = DEMO_LIMITS[0]!;
  it("allows exactly the per-invoice cap and refuses one unit over", () => {
    expect(checkInvoice(limits, 0, t0.perInvoice, 0n).ok).toBe(true);
    const r = checkInvoice(limits, 0, t0.perInvoice + 1n, 0n);
    expect(r).toMatchObject({ ok: false, reason: "per_invoice", nextTier: 1 });
  });
  it("allows reaching the daily cap exactly and refuses one unit over", () => {
    expect(checkInvoice(limits, 0, 10n, t0.dailyVolume - 10n).ok).toBe(true);
    expect(checkInvoice(limits, 0, 11n, t0.dailyVolume - 10n)).toMatchObject({ ok: false, reason: "daily_volume", nextTier: 1 });
  });
  it("reports per-invoice before daily volume", () => {
    expect(checkInvoice(limits, 0, t0.perInvoice + 1n, t0.dailyVolume)).toMatchObject({ reason: "per_invoice" });
  });
  it("has no next tier at the top", () => {
    const top = DEMO_LIMITS[4]!;
    expect(checkInvoice(limits, 4, top.perInvoice + 1n, 0n)).toMatchObject({ ok: false, nextTier: null });
  });
});

describe("financing and investor gates", () => {
  const limits = resolveLimits([]);
  it("financing needs tier 3 or higher", () => {
    expect(checkFinancing(limits, 2, USDT(1))).toMatchObject({ ok: false, reason: "financing_tier", nextTier: 3 });
    expect(checkFinancing(limits, 3, USDT(1)).ok).toBe(true);
    expect(checkFinancing(limits, 4, USDT(1)).ok).toBe(true);
  });
  it("financing is capped per invoice, exactly at the cap", () => {
    const cap = DEMO_LIMITS[3]!.financingCap;
    expect(checkFinancing(limits, 3, cap).ok).toBe(true);
    expect(checkFinancing(limits, 3, cap + 1n)).toMatchObject({ ok: false, reason: "financing_cap", nextTier: 4 });
  });
  it("investors need tier 4", () => {
    expect(checkInvestor(limits, 3)).toMatchObject({ ok: false, nextTier: 4 });
    expect(checkInvestor(limits, 4).ok).toBe(true);
  });
});

describe("nextStepFor", () => {
  it("points each tier at a route", () => {
    expect(nextStepFor(0)).toMatchObject({ tier: 1, route: "email" });
    expect(nextStepFor(1)).toMatchObject({ tier: 2, route: "domain" });
    expect(nextStepFor(2)).toMatchObject({ tier: 3, route: "world" });
    expect(nextStepFor(3)).toMatchObject({ tier: 4, route: "documents" });
    expect(nextStepFor(4)).toBeNull();
  });
});
