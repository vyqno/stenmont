import { describe, expect, it } from "vitest";
import { STEP_EXPLANATIONS, buildSteps, certificateUrl, currentStep, formatWhen, shortAddr, type TimelineItem } from "../lib/financingTimeline";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const NOW = Date.parse("2026-11-06T12:00:00Z");
const base: TimelineItem = {
  claimId: "cl_1", invoiceId: `0x${"ab".repeat(32)}`, invoiceNumber: "INV-1", invoiceStatus: "open", status: "listed", showInvoiceNumber: false,
  face: "100", price: "95", discount: "5", reserve: "10", advance: "85", discountBps: 500, reserveBps: 1000, amountPaid: "0",
  dueDate: "2026-12-06T12:00:00.000Z", fundBy: "2026-11-13T12:00:00.000Z", investor: null,
  times: { listedAt: "2026-11-06T10:01:00.000Z", fundedAt: null, closedAt: null },
  transactions: { list: H(1), fund: null, close: null }, payments: [],
};
const investor = { address: "0x4444444444444444444444444444444444444444", verified: true, verifiedAt: "2026-11-06T09:00:00.000Z", allowTx: H(7) };
const funded: TimelineItem = { ...base, status: "funded", investor, times: { ...base.times, fundedAt: "2026-11-06T10:05:00.000Z" }, transactions: { list: H(1), fund: H(2), close: null } };
const settled: TimelineItem = {
  ...funded, status: "settled", invoiceStatus: "paid", amountPaid: "100", times: { ...funded.times, closedAt: "2026-11-06T11:00:00.000Z" },
  transactions: { list: H(1), fund: H(2), close: H(3) }, payments: [{ value: "100", txHash: H(3), at: "2026-11-06T11:00:00.000Z" }],
};
const defaulted: TimelineItem = { ...funded, status: "defaulted", times: { ...funded.times, closedAt: "2026-12-14T00:00:00.000Z" }, transactions: { list: H(1), fund: H(2), close: H(4) } };
const states = (i: TimelineItem, now = NOW) => buildSteps(i, now).map((s) => `${s.key}:${s.state}`);
const step = (i: TimelineItem, key: string, now = NOW) => buildSteps(i, now).find((s) => s.key === key)!;

describe("buildSteps", () => {
  it("always returns the five steps in order", () => {
    expect(buildSteps(base, NOW).map((s) => s.key)).toEqual(["listed", "investor", "funded", "payment", "close"]);
    expect(Object.keys(STEP_EXPLANATIONS).sort()).toEqual(["close", "funded", "investor", "listed", "payment"]);
  });

  it("listed: the offer is open, waiting for an investor", () => {
    expect(states(base)).toEqual(["listed:done", "investor:current", "funded:waiting", "payment:waiting", "close:waiting"]);
    const s = step(base, "listed");
    expect(s.at).toBe("2026-11-06T10:01:00.000Z");
    expect(s.url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(1)}`);
    expect(s.facts).toEqual(expect.arrayContaining([{ label: "Invoice value", value: "$100.00" }, { label: "Offer price", value: "$95.00" }, { label: "Discount", value: "$5.00 (5%)" }, { label: "Held back", value: "$10.00" }]));
  });

  it("funded: cash received today is the advance, the reserve is held back", () => {
    expect(states(funded)).toEqual(["listed:done", "investor:done", "funded:done", "payment:current", "close:waiting"]);
    const f = step(funded, "funded");
    expect(f.facts).toEqual(expect.arrayContaining([{ label: "Cash received today", value: "$85.00" }, { label: "Investor paid", value: "$95.00" }, { label: "Held until the customer pays", value: "$10.00" }]));
    expect(f.url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(2)}`);
    const inv = step(funded, "investor");
    expect(inv.url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(7)}`);
    expect(inv.at).toBe("2026-11-06T09:00:00.000Z");
    expect(inv.facts).toEqual(expect.arrayContaining([{ label: "Investor", value: "0x4444…4444" }, { label: "Identity", value: "Verified as a real person with World" }]));
  });

  it("an investor without a recorded World proof (test approval) is shown honestly", () => {
    const i = { ...funded, investor: { ...investor, verified: false, verifiedAt: null } };
    expect(step(i, "investor").facts).toEqual(expect.arrayContaining([{ label: "Identity", value: "No World proof recorded (approved directly by Stenmont)" }]));
  });

  it("settled: the customer paid, the investor was repaid, the reserve came back", () => {
    expect(states(settled)).toEqual(["listed:done", "investor:done", "funded:done", "payment:done", "close:done"]);
    expect(step(settled, "payment").url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(3)}`);
    const c = step(settled, "close");
    expect(c.title).toBe("Settled");
    expect(c.facts).toEqual(expect.arrayContaining([{ label: "Investor repaid", value: "$100.00" }, { label: "Investor's profit", value: "$5.00" }, { label: "Reserve returned to you", value: "$10.00" }, { label: "You received in total", value: "$95.00" }]));
    expect(currentStep(settled)).toBeNull();
  });

  it("defaulted: unpaid after the grace period, the reserve went to the investor, you keep the advance", () => {
    expect(states(defaulted)).toEqual(["listed:done", "investor:done", "funded:done", "payment:failed", "close:failed"]);
    const c = step(defaulted, "close");
    expect(c.title).toBe("Defaulted");
    expect(c.facts).toEqual(expect.arrayContaining([{ label: "Reserve paid to the investor", value: "$10.00" }, { label: "You keep", value: "$85.00" }]));
  });

  it("while funded: says when it becomes overdue and when a default is possible (due date plus 7 days)", () => {
    const p = step(funded, "payment");
    expect(p.facts).toEqual(expect.arrayContaining([{ label: "Due", value: "6 Dec 2026" }, { label: "Paid so far", value: "$0.00" }]));
    expect(step(funded, "close").facts).toEqual([{ label: "Default possible after", value: "13 Dec 2026" }]);
    const late = step(funded, "payment", Date.parse("2026-12-09T12:00:00Z"));
    expect(late.facts).toEqual(expect.arrayContaining([{ label: "Status", value: "Overdue by 3 days" }]));
  });

  it("funding in progress counts as funded for the business, never as settled", () => {
    expect(states({ ...base, status: "funding", investor })).toEqual(["listed:done", "investor:done", "funded:current", "payment:waiting", "close:waiting"]);
  });

  it("cancelled: the offer ended without a sale", () => {
    expect(states({ ...base, status: "cancelled" })).toEqual(["listed:done", "investor:skipped", "funded:skipped", "payment:skipped", "close:skipped"]);
    expect(step({ ...base, status: "cancelled" }, "close").title).toBe("Not sold");
  });

  it("a missing time or hash is null, never a made-up value", () => {
    const s = step({ ...funded, times: { listedAt: null, fundedAt: null, closedAt: null }, transactions: { list: null, fund: null, close: null } }, "funded");
    expect(s.at).toBeNull();
    expect(s.url).toBeNull();
    expect(s.txHash).toBeNull();
  });
});

describe("currentStep", () => {
  it("is the step the business is waiting on", () => {
    expect(currentStep(base)).toBe("investor");
    expect(currentStep(funded)).toBe("payment");
    expect(currentStep({ ...base, status: "funding", investor })).toBe("funded");
    expect(currentStep(defaulted)).toBeNull();
  });
});

describe("small helpers", () => {
  it("formatWhen is stable (UTC)", () => {
    expect(formatWhen("2026-11-06T10:01:30.000Z")).toBe("6 Nov 2026, 10:01 UTC");
    expect(formatWhen(null)).toBe("Not recorded");
    expect(formatWhen("garbage")).toBe("Not recorded");
  });
  it("shortAddr and certificateUrl", () => {
    expect(shortAddr("0x50c94c3021962047F10c9c58D80C4A7b73182a63")).toBe("0x50c9…2a63");
    expect(certificateUrl("https://app-staging.stenmont.com", `0x${"ab".repeat(32)}`)).toBe(`https://app-staging.stenmont.com/claim/0x${"ab".repeat(32)}`);
  });
});
