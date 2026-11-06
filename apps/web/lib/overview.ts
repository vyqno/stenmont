import { fromUnits, toUnits } from "@stenmont/shared";
import { progress, type Site, type Switch } from "./sites";

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const previousMonthKey = (d: Date) => monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthLabel = monthName;

// ---- books: received this month, and whether a month is closed --------------------------------------------------------

export type BookLine = { kind: string; amount: string; currency: string };
export type BooksMonth = { locked: boolean; snapshot: { period: string; lines: BookLine[] } };

/** Money in minus money back for the month, in dollars (USDT lines only). Payments, instalments and refunds are what a business "received". */
export function receivedIn(lines: BookLine[]): string {
  let total = 0n;
  for (const l of lines) {
    if (l.currency !== "USDT") continue;
    if (l.kind === "payment" || l.kind === "instalment") total += BigInt(l.amount);
    else if (l.kind === "refund") total -= BigInt(l.amount);
  }
  return fromUnits(total < 0n ? 0n : total);
}

export type BooksStatus = { month: string; closed: boolean; previous: { month: string; closed: boolean } | null };
export function booksStatus(now: Date, current: BooksMonth | null, previous: BooksMonth | null): BooksStatus {
  return {
    month: monthName(monthKey(now)),
    closed: !!current?.locked,
    previous: previous ? { month: monthName(previousMonthKey(now)), closed: previous.locked } : null,
  };
}

// ---- invoices ---------------------------------------------------------------------------------------------------------

export type InvoiceLite = { status: string; amount: string; amountPaid: string; dueDate: string | null };
export function openInvoices(rows: InvoiceLite[], now: number) {
  let outstanding = 0n;
  let count = 0;
  let overdue = 0;
  for (const i of rows) {
    if (i.status !== "open" && i.status !== "partially_paid") continue;
    count++;
    outstanding += toUnits(i.amount) - toUnits(i.amountPaid);
    if (i.dueDate && Date.parse(i.dueDate) < now) overdue++;
  }
  return { count, outstanding: fromUnits(outstanding), overdue };
}

// ---- subscriptions and instalments ------------------------------------------------------------------------------------

export type SubLite = { status: string; kind?: string; nextChargeAt: string | null };
/** Active or late agreements whose next charge falls within `days` days (or is already late). */
export function dueSoon(subs: SubLite[], now: number, days = 7) {
  const limit = now + days * 86_400_000;
  let subscriptions = 0;
  let instalments = 0;
  for (const s of subs) {
    if ((s.status !== "active" && s.status !== "past_due") || !s.nextChargeAt) continue;
    if (Date.parse(s.nextChargeAt) > limit) continue;
    if (s.kind === "instalment") instalments++;
    else subscriptions++;
  }
  return { subscriptions, instalments, total: subscriptions + instalments };
}

// ---- site status ------------------------------------------------------------------------------------------------------

export type SiteStatus = { state: "none" | "live" | "paused"; checks: string | null; ready: boolean };
export function siteStatus(sites: Site[], sw: Switch | null): SiteStatus {
  if (sites.length === 0) return { state: "none", checks: null, ready: false };
  // The site closest to ready is the one worth reporting.
  const best = [...sites].sort((a, b) => Number(b.ready) - Number(a.ready) || Number.parseInt(progress(b)) - Number.parseInt(progress(a)))[0]!;
  return { state: sw?.paused ? "paused" : "live", checks: `${progress(best)} checks passed`, ready: best.ready };
}

// ---- next steps for a new business ------------------------------------------------------------------------------------

export type Step = { id: "verify" | "connect" | "product" | "profile"; title: string; help: string; href: string; done: boolean | null };
/** `null` means we could not find out; the step is then shown without a tick rather than guessed. */
export function nextSteps(i: { tier: number | null; siteReady: boolean | null; products: number | null; profilePublished: boolean | null }): Step[] {
  return [
    { id: "verify", title: "Verify your business", help: "Confirm your email, website or identity to raise your limits.", href: "/dashboard/verification", done: i.tier === null ? null : i.tier >= 1 },
    { id: "connect", title: "Connect your site", help: "Install checkout and pass the four checks.", href: "/dashboard/connect", done: i.siteReady },
    { id: "product", title: "Add a product", help: "Add what you sell, or import it from Shopify.", href: "/dashboard/catalog", done: i.products === null ? null : i.products > 0 },
    { id: "profile", title: "Publish your public profile", help: "Tell customers and agents how to pay you.", href: "/dashboard/profile", done: i.profilePublished },
  ];
}
export const stepsLeft = (steps: Step[]) => steps.filter((s) => s.done !== true).length;
