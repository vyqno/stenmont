import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverviewView, type OverviewProps } from "../app/dashboard/OverviewView";
import { booksStatus, dueSoon, monthKey, nextSteps, openInvoices, previousMonthKey, receivedIn, siteStatus, stepsLeft } from "../lib/overview";
import type { Site } from "../lib/sites";

// Sample values for tests only.
const NOW = Date.parse("2026-11-06T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("months", () => {
  it("names this month and the one before, across a year end", () => {
    expect(monthKey(new Date("2026-11-06T12:00:00Z"))).toBe("2026-11");
    expect(previousMonthKey(new Date("2026-11-06T12:00:00Z"))).toBe("2026-10");
    expect(previousMonthKey(new Date("2026-01-15T00:00:00Z"))).toBe("2025-12");
  });
});

describe("received this month", () => {
  it("adds payments and instalments, subtracts refunds, ignores everything else", () => {
    const lines = [
      { kind: "payment", amount: "2500000", currency: "USDT" },
      { kind: "instalment", amount: "1000000", currency: "USDT" },
      { kind: "refund", amount: "500000", currency: "USDT" },
      { kind: "tax", amount: "999999999", currency: "USDT" },
      { kind: "early_discount", amount: "999999999", currency: "USDT" },
      { kind: "payment", amount: "999999999", currency: "WBT" },
    ];
    expect(receivedIn(lines)).toBe("3");
    expect(receivedIn(lines.slice(0, 1))).toBe("2.5");
  });
  it("is zero with no lines and never negative", () => {
    expect(receivedIn([])).toBe("0");
    expect(receivedIn([{ kind: "refund", amount: "1000000", currency: "USDT" }])).toBe("0");
  });
});

describe("invoices", () => {
  it("counts only unpaid invoices and what is still owed", () => {
    const r = openInvoices(
      [
        { status: "open", amount: "10", amountPaid: "0", dueDate: day(-1) },
        { status: "partially_paid", amount: "20", amountPaid: "5", dueDate: day(3) },
        { status: "paid", amount: "99", amountPaid: "99", dueDate: null },
        { status: "cancelled", amount: "50", amountPaid: "0", dueDate: null },
      ],
      NOW,
    );
    expect(r).toEqual({ count: 2, outstanding: "25", overdue: 1 });
  });
});

describe("due soon", () => {
  it("counts subscriptions and instalments due in 7 days, including late ones", () => {
    const r = dueSoon(
      [
        { status: "active", nextChargeAt: day(2) },
        { status: "past_due", kind: "instalment", nextChargeAt: day(-1) },
        { status: "active", kind: "instalment", nextChargeAt: day(30) },
        { status: "cancelled", nextChargeAt: day(1) },
        { status: "offered", nextChargeAt: null },
      ],
      NOW,
    );
    expect(r).toEqual({ subscriptions: 1, instalments: 1, total: 2 });
  });
});

const site = (passed: number, ready = false): Site => {
  const ok = { ok: true, detail: "", checkedAt: "2026-11-06T00:00:00Z" };
  const kinds = ["reachable", "domain", "webhook", "payment"] as const;
  return { id: "s", url: "https://a.example", host: "a.example", platform: null, createdAt: "", verification: { recordName: "", recordValue: "" }, ready, checks: Object.fromEntries(kinds.map((k, i) => [k, i < passed ? ok : null])) as Site["checks"] };
};

describe("site status", () => {
  it("says none, live with checks, or paused", () => {
    expect(siteStatus([], null)).toEqual({ state: "none", checks: null, ready: false });
    expect(siteStatus([site(1), site(3)], { paused: false, mode: "live", updatedAt: null })).toEqual({ state: "live", checks: "3 of 4 checks passed", ready: false });
    expect(siteStatus([site(4, true)], { paused: true, mode: "live", updatedAt: null }).state).toBe("paused");
  });
});

describe("books status", () => {
  it("reports the open or closed state of this and last month", () => {
    const s = booksStatus(new Date(NOW), { locked: false, snapshot: { period: "2026-11", lines: [] } }, { locked: true, snapshot: { period: "2026-10", lines: [] } });
    expect(s).toEqual({ month: "November 2026", closed: false, previous: { month: "October 2026", closed: true } });
    expect(booksStatus(new Date(NOW), null, null).previous).toBeNull();
  });
});

describe("next steps", () => {
  it("a brand new business has all four left", () => {
    const s = nextSteps({ tier: 0, siteReady: false, products: 0, profilePublished: false });
    expect(s.map((x) => x.id)).toEqual(["verify", "connect", "product", "profile"]);
    expect(stepsLeft(s)).toBe(4);
    expect(s.map((x) => x.href)).toEqual(["/dashboard/verification", "/dashboard/connect", "/dashboard/catalog", "/dashboard/profile"]);
  });
  it("ticks what is done and keeps unknown steps open instead of guessing", () => {
    const s = nextSteps({ tier: 2, siteReady: true, products: null, profilePublished: false });
    expect(s.map((x) => x.done)).toEqual([true, true, null, false]);
    expect(stepsLeft(s)).toBe(2);
  });
});

const ready = <T,>(value: T) => ({ status: "ready" as const, value });
const empty: OverviewProps = {
  now: NOW,
  steps: ready(nextSteps({ tier: 0, siteReady: false, products: 0, profilePublished: false })),
  received: ready("0"),
  invoices: ready({ rows: [], count: 0, outstanding: "0", overdue: 0 }),
  due: ready({ subscriptions: 0, instalments: 0, total: 0 }),
  site: ready({ state: "none" as const, checks: null, ready: false }),
  books: ready({ month: "November 2026", closed: false, previous: null }),
  agent: ready({ daily: 0, monthly: 0, limits: { daily: 1000, monthly: 20000 } }),
};

describe("OverviewView", () => {
  it("gives a new business honest empty states and the checklist, with no invented numbers", () => {
    const html = renderToStaticMarkup(<OverviewView {...empty} />);
    expect(html).toContain("4 of 4 steps left");
    expect(html).toContain('href="/dashboard/profile"');
    expect(html).toContain("No invoices yet");
    expect(html).toContain("No site connected");
    expect(html).toContain("Received this month");
    expect(html).toMatch(/data-testid="stat-received"[^>]*>\$0\.00/);
  });
  it("shows a set-up business without the checklist, with site checks and the books state", () => {
    const html = renderToStaticMarkup(
      <OverviewView
        {...empty}
        steps={ready(nextSteps({ tier: 2, siteReady: true, products: 3, profilePublished: true }))}
        site={ready({ state: "live" as const, checks: "3 of 4 checks passed", ready: false })}
        books={ready({ month: "November 2026", closed: false, previous: { month: "October 2026", closed: false } })}
        due={ready({ subscriptions: 2, instalments: 1, total: 3 })}
      />,
    );
    expect(html).toContain("all-set");
    expect(html).not.toContain("next-steps");
    expect(html).toContain("3 of 4 checks passed");
    expect(html).toContain("Live");
    expect(html).toContain("Not closed yet");
    expect(html).toContain("2 subscriptions and 1 instalment");
  });
  it("shows Unavailable, never zero, when a figure cannot be read", () => {
    const html = renderToStaticMarkup(<OverviewView {...empty} received={{ status: "error", message: "x" }} due={{ status: "error", message: "x" }} />);
    expect(html).toContain("Unavailable");
    expect(html).not.toMatch(/data-testid="stat-received"[^>]*>\$0/);
  });
  it("shows loading marks while data arrives", () => {
    const html = renderToStaticMarkup(<OverviewView {...empty} steps={{ status: "loading" }} invoices={{ status: "loading" }} />);
    expect(html).toContain("aria-busy");
  });
  it("shows the assistant meter with its limits", () => {
    const html = renderToStaticMarkup(<OverviewView {...empty} agent={ready({ daily: 250, monthly: 5000, limits: { daily: 1000, monthly: 20000 } })} />);
    expect(html).toContain('role="meter"');
    expect(html).toContain("250 of 1,000 used today");
  });
});
