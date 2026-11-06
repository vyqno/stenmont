import { parseSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { TIERS, buildWalletMessage, formatUsd, ladder, routeCards, unlocks, walletErrorText, type VerificationStatus } from "../lib/verification";

const limits = [
  { tier: 0, perInvoice: "100", dailyVolume: "500", financing: false, financingCap: "0", investor: false },
  { tier: 1, perInvoice: "500", dailyVolume: "2000", financing: false, financingCap: "0", investor: false },
  { tier: 2, perInvoice: "2000", dailyVolume: "10000", financing: false, financingCap: "0", investor: false },
  { tier: 3, perInvoice: "10000", dailyVolume: "50000", financing: true, financingCap: "5000", investor: false },
  { tier: 4, perInvoice: "1000000", dailyVolume: "5000000", financing: true, financingCap: "1000000", investor: true },
];
const status = (over: Partial<VerificationStatus> = {}): VerificationStatus => ({
  tier: 0, via: null, nextStep: { tier: 1, route: "email", howTo: "x" }, usedToday: "0", limits,
  facts: { worldEnrolled: false, domainVerified: false }, records: [], badge: null, kyc: { available: true, provider: "mock", sandbox: true }, ...over,
});
const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("formatUsd", () => {
  it("adds separators and drops needless decimals", () => {
    expect(formatUsd("100")).toBe("$100");
    expect(formatUsd("1000000")).toBe("$1,000,000");
    expect(formatUsd("12.5")).toBe("$12.50");
  });
});

describe("unlocks", () => {
  it("states per-invoice and daily limits in plain words", () => {
    expect(unlocks(limits[0]!)).toEqual(["Invoices up to $100 each", "Up to $500 of invoices a day"]);
  });
  it("adds selling and investing where the tier allows them", () => {
    expect(unlocks(limits[3]!)).toContain("Sell unpaid invoices up to $5,000 for cash now");
    expect(unlocks(limits[4]!)).toContain("Fund other businesses' invoices as an investor");
    expect(unlocks(limits[2]!).some((u) => /Sell/.test(u))).toBe(false);
  });
});

describe("ladder", () => {
  it("lists the five tiers with the current one marked and earlier ones reached", () => {
    const l = ladder(status({ tier: 2 }));
    expect(l.map((r) => r.tier)).toEqual([0, 1, 2, 3, 4]);
    expect(l.map((r) => r.state)).toEqual(["reached", "reached", "current", "next", "later"]);
    expect(l[3]!.unlocks.length).toBeGreaterThan(0);
  });
  it("at the top there is no next tier", () => {
    expect(ladder(status({ tier: 4 })).map((r) => r.state)).toEqual(["reached", "reached", "reached", "reached", "current"]);
  });
  it("uses plain words for every tier name (no crypto jargon on the web2 route)", () => {
    for (const t of TIERS) expect(`${t.name} ${t.how}`).not.toMatch(/wallet|gas|chain|token|crypto|blockchain/i);
  });
});

describe("routeCards", () => {
  it("shows the four routes with their state", () => {
    const cards = routeCards(status({ facts: { worldEnrolled: true, domainVerified: false }, tier: 3 }), NOW);
    expect(cards.map((c) => [c.route, c.state])).toEqual([["email", "open"], ["domain", "open"], ["world", "done"], ["documents", "open"]]);
  });
  it("counts an approved, unexpired record, and ignores an expired or rejected one", () => {
    const rec = (method: string, over = {}) => ({ method, decision: "approved", decidedAt: "2026-11-01T00:00:00Z", expiresAt: null, ...over });
    const s = status({ records: [rec("email"), rec("kyc", { expiresAt: "2026-11-06T11:59:59Z" }), rec("domain", { decision: "rejected" })] });
    const byRoute = Object.fromEntries(routeCards(s, NOW).map((c) => [c.route, c.state]));
    expect(byRoute).toEqual({ email: "done", domain: "open", world: "open", documents: "open" });
  });
  it("a pending document check shows as in progress", () => {
    const s = status({ records: [{ method: "kyc", decision: "pending", decidedAt: "2026-11-06T11:00:00Z", expiresAt: null }] });
    expect(routeCards(s, NOW).find((c) => c.route === "documents")!.state).toBe("pending");
  });
  it("the private route says plainly that no documents are shared", () => {
    expect(routeCards(status(), NOW).find((c) => c.route === "world")!.plain).toMatch(/no documents/i);
  });
  it("the document route says it needs the document check to be available", () => {
    expect(routeCards(status({ kyc: { available: false, provider: null, sandbox: false } }), NOW).find((c) => c.route === "documents")!.state).toBe("unavailable");
  });
});

describe("buildWalletMessage", () => {
  it("builds a canonical sign-in message for this site, chain and nonce", () => {
    const m = buildWalletMessage({ address: "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e", nonce: "abcdef1234567890abcdef1234567890", host: "app.stenmont.com", origin: "https://app.stenmont.com", chainId: 1874, now: new Date(NOW) });
    const p = parseSiweMessage(m);
    expect(p).toMatchObject({ domain: "app.stenmont.com", uri: "https://app.stenmont.com", chainId: 1874, nonce: "abcdef1234567890abcdef1234567890", version: "1" });
    expect(p.expirationTime!.getTime() - p.issuedAt!.getTime()).toBe(600_000);
  });
});

describe("walletErrorText", () => {
  it("turns server codes into plain sentences", () => {
    expect(walletErrorText({ code: "wallet_taken" })).toMatch(/another business/);
    expect(walletErrorText({ code: "bad_signature" })).toMatch(/did not match/);
    expect(walletErrorText({ code: "nonce_invalid" })).toMatch(/Try again/);
    expect(walletErrorText({ code: "siwe_invalid", reason: "expired" })).toMatch(/too long/);
    expect(walletErrorText({ code: "something_else" })).toMatch(/could not/i);
  });
  it("treats a refused wallet prompt as cancelled", () => {
    expect(walletErrorText({ code: "4001" })).toMatch(/cancelled/i);
    expect(walletErrorText({ name: "UserRejectedRequestError" })).toMatch(/cancelled/i);
  });
});
