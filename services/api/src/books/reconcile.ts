import { leafHash, type ReceiptLeaf } from "@stenmont/shared";

/**
 * Close the month, step one: match what the business invoiced with what the chain says happened, and turn it into ledger
 * lines. Pure: no database, no clock, no network. Cash basis (revenue when money arrives). Money is USDT base units
 * (6 decimals); gas is wei of WBT and is only ever converted for display when the caller supplies a rate.
 * We split tax that is already inside the amount paid; we do not know anyone's tax law.
 */

type Hex = `0x${string}`;
export type Inv = {
  id: string; number: string; amount: bigint; status: string;
  taxRateBps: number | null; taxLabel: string | null; dueDate: string | null; createdAt: string; createTxHash: string | null;
  /** Pay `bps` less if the invoice is settled by `until`. Nothing stores this yet; the module is ready for when something does. */
  earlyDiscount?: { bps: number; until: string } | null;
};
type Event = { id: string; invoiceId: string; value: bigint; txHash: string; blockNumber?: number; at: string; recordedAt?: string; sourceKey?: string; bookedPeriod?: string };
export type Pay = Event & { payer: string; rail?: "replacement_subscription"; agreementId?: string };
export type Ref = Event & { to: string };
export type Claim = {
  id: string; invoiceId: string; status: string; face: bigint; price: bigint; reserve: bigint;
  fundRecordedAt?: string; closeRecordedAt?: string; fundBookedPeriod?: string; closeBookedPeriod?: string;
  fundTxHash: string | null; closeTxHash: string | null; fundedAt: string | null; closedAt: string | null;
};
export type Gas = { id: string; txHash: string | null; kind: string; wei: bigint; at: string; recordedAt?: string; sourceKey?: string; bookedPeriod?: string };
export type Input = {
  period: string; invoices: Inv[]; payments: Pay[]; refunds: Ref[]; claims: Claim[]; gas: Gas[];
  /** Months already closed -> when. An event for a closed month that arrives later is booked in the month it arrived. */
  closedPeriods?: Record<string, string>;
  /** USDT base units per 1 WBT, and where that number came from. Never guessed. */
  gasRate?: { usdtPerWbt: bigint; source: string };
};

export type LineKind =
  | "payment" | "instalment" | "refund" | "tax" | "early_discount" | "advance" | "reserve_held" | "financing_discount"
  | "reserve_release" | "reserve_forfeit" | "payment_to_investor" | "gas";
export type Line = {
  seq: number; date: string; kind: LineKind; invoice: string | null; invoiceId: string | null; description: string;
  debit: string | null; credit: string | null; // null on both = a memo line (money that never touched this business)
  amount: bigint; currency: "USDT" | "WBT"; usdtValue: bigint | null; txHash: string | null; leafId: Hex | null; adjustmentFor: string | null;
};
export type FlagCode =
  | "payment_without_invoice" | "payment_on_inactive_invoice" | "partial_payment" | "overpayment" | "refund_without_payment"
  | "refund_exceeds_payment" | "zero_amount" | "past_due" | "prior_period_invoice" | "default_reserve_unverified" | "gas_unconverted";
export type Flag = { code: FlagCode; severity: "warn" | "info"; invoice: string | null; txHash: string | null; message: string };
export type InvoiceState = "unpaid" | "partial" | "paid" | "overpaid";
export type InvoiceRow = {
  invoiceId: string; number: string; amount: bigint; expected: bigint; status: string; state: InvoiceState; sold: boolean;
  paidToDate: bigint; refundedToDate: bigint; paidInPeriod: bigint; refundedInPeriod: bigint; open: bigint; overpaid: bigint;
  taxRateBps: number | null; taxLabel: string | null;
};
export type Result = {
  period: string; bookedSourceIds: string[]; lines: Line[]; invoices: InvoiceRow[]; flags: Flag[]; leaves: (ReceiptLeaf & { leafId: Hex })[];
  trialBalance: { account: string; currency: "USDT" | "WBT"; debit: bigint; credit: bigint }[];
  gasWei: bigint; gasUsdt: bigint | null; gasRateSource: string | null;
};

const DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export function periodBounds(id: string) {
  const m = DAY_RE.exec(id);
  if (!m) throw new Error("period must look like 2026-11");
  const [y, mo] = [Number(m[1]), Number(m[2])];
  const iso = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString();
  return { id, start: iso(y, mo), end: mo === 12 ? iso(y + 1, 1) : iso(y, mo + 1) };
}
export const periodOf = (iso: string) => iso.slice(0, 7);

export const ACCOUNTS = {
  cash: "Cash (USDT)", revenue: "Sales revenue", suspense: "Suspense (unmatched)", refunds: "Refunds to customers",
  discounts: "Sales discounts", financing: "Financing discount", reserve: "Reserve held by investor contract",
  forfeited: "Reserve forfeited", gas: "Network fees (gas)", tank: "Gas tank (WBT)",
} as const;
const taxAccount = (label: string | null) => `Tax payable (${label ?? "Tax"})`;
const ZERO_ID = `0x${"00".repeat(32)}`;
const INACTIVE = new Set(["cancelled", "failed", "expired", "creating"]);
const WEI = 10n ** 18n;
const taxIn = (gross: bigint, bps: number | null) => (bps ? (gross * BigInt(bps)) / (10_000n + BigInt(bps)) : 0n);

type Group = { date: string; rank: number; key: string; lines: Omit<Line, "seq">[] };

export function reconcile(input: Input): Result {
  const p = periodBounds(input.period);
  const closed = input.closedPeriods ?? {};
  const invById = new Map(input.invoices.map((i) => [i.id, i]));
  const claimsOf = new Map(input.claims.filter((c) => c.fundedAt && c.fundTxHash && ["funded", "settled", "defaulted"].includes(c.status)).map((c) => [c.invoiceId, c]));

  /** The date an event counts from: its own, unless its month was closed before we heard about it. */
  const effective = (at: string, recorded: string | undefined, bookedPeriod?: string) => {
    if (bookedPeriod) return { date: bookedPeriod === periodOf(at) ? at : periodBounds(bookedPeriod).start, adjustmentFor: bookedPeriod === periodOf(at) ? null : periodOf(at) };
    const closeAt = closed[periodOf(at)];
    if (closeAt && recorded && recorded > closeAt) {
      let month = periodOf(recorded) > periodOf(at) ? periodOf(recorded) : periodOf(periodBounds(periodOf(at)).end);
      // A closed interim snapshot can never absorb new records; skip any later month already locked as well.
      while (closed[month] && recorded > closed[month]!) month = periodOf(periodBounds(month).end);
      const date = month === periodOf(recorded) ? recorded : periodBounds(month).start;
      return { date, adjustmentFor: periodOf(at) };
    }
    return { date: at, adjustmentFor: null };
  };
  const inPeriod = (d: string) => d >= p.start && d < p.end;

  const bookedSourceIds = new Set<string>();
  const flags: Flag[] = [];
  const flag = (code: FlagCode, severity: Flag["severity"], invoice: string | null, txHash: string | null, message: string) => flags.push({ code, severity, invoice, txHash, message });
  const groups: Group[] = [];
  const sources = new Map<string, ReceiptLeaf & { leafId: Hex }>();
  const source = (txHash: string, invoiceId: string | null, amount: bigint, kind: string): Hex => {
    const key = `${txHash}|${kind}|${invoiceId}|${amount}`;
    let s = sources.get(key);
    if (!s) {
      const leaf = { txHash: txHash as Hex, invoiceId: (invoiceId ?? ZERO_ID) as Hex, amount, kind };
      s = { ...leaf, leafId: leafHash(leaf) };
      sources.set(key, s);
    }
    return s.leafId;
  };

  // Everything that happened to an invoice, oldest first (payments before refunds at the same instant).
  type Ev = { kind: "pay" | "refund"; date: string; adj: string | null; row: Pay | Ref };
  const byInvoice = new Map<string, Ev[]>();
  const push = (e: Ev) => (byInvoice.get(e.row.invoiceId) ?? byInvoice.set(e.row.invoiceId, []).get(e.row.invoiceId)!).push(e);
  for (const r of input.payments) { const e = effective(r.at, r.recordedAt, r.bookedPeriod); if (e.date < p.end) push({ kind: "pay", date: e.date, adj: e.adjustmentFor, row: r }); }
  for (const r of input.refunds) { const e = effective(r.at, r.recordedAt, r.bookedPeriod); if (e.date < p.end) push({ kind: "refund", date: e.date, adj: e.adjustmentFor, row: r }); }

  const rows: InvoiceRow[] = [];
  const eventInvoices = new Set<string>();
  const seenInvoiceIds = new Set<string>();

  const lineBase = (date: string, adj: string | null, description: string) => ({ date, adjustmentFor: adj, description: adj ? `Adjustment for ${adj}: ${description}` : description });

  const handle = (invoiceId: string, events: Ev[]) => {
    const inv = invById.get(invoiceId) ?? null;
    const claim = claimsOf.get(invoiceId) ?? null;
    const replacement = events.some(e => e.kind === "pay" && (e.row as Pay).rail === "replacement_subscription");
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.row.id.localeCompare(b.row.id) : a.kind === "pay" ? -1 : 1));
    let paid = 0n, refunded = 0n, paidIn = 0n, refundedIn = 0n, discount = 0n;
    const expectedOf = () => (inv ? inv.amount - discount : 0n);
    const earlyOffer = inv?.earlyDiscount ? (inv.amount * BigInt(inv.earlyDiscount.bps)) / 10_000n : 0n;
    const num = inv?.number ?? null;
    for (const e of events) {
      const r = e.row;
      const inside = inPeriod(e.date);
      if (r.value === 0n) { if (inside) flag("zero_amount", "info", num, r.txHash, `A ${e.kind === "pay" ? "payment" : "refund"} of zero was recorded; it has no ledger line.`); continue; }
      if (e.kind === "pay") {
        const replacementReceipt = (r as Pay).rail === "replacement_subscription";
        const sold = !replacementReceipt && !!claim && e.date >= claim.fundedAt!;
        paid += r.value;
        if (inside) { paidIn += r.value; eventInvoices.add(invoiceId); }
        let discountHere = 0n;
        if (inv?.earlyDiscount && earlyOffer > 0n && discount === 0n && paid >= inv.amount - earlyOffer && paid < inv.amount && e.date <= inv.earlyDiscount.until) { discountHere = earlyOffer; discount = earlyOffer; }
        if (!inside) continue;
        bookedSourceIds.add(r.sourceKey ?? `pay:${r.id}`);
        const key = `pay:${r.txHash}:${r.id}`;
        const leaf = source(r.txHash, invoiceId, r.value, replacementReceipt ? "instalment" : "payment");
        const common = { invoice: num, invoiceId, txHash: r.txHash, leafId: leaf, currency: "USDT" as const, usdtValue: null };
        const lines: Group["lines"] = [];
        if (sold) {
          lines.push({ ...lineBase(e.date, e.adj, `Payment ${num} paid to the investor who bought the invoice`), kind: "payment_to_investor", debit: null, credit: null, amount: r.value, ...common });
        } else if (!inv) {
          flag("payment_without_invoice", "warn", null, r.txHash, `A payment of ${r.value} base units arrived for an invoice we have no record of (${invoiceId.slice(0, 10)}…). Booked to suspense.`);
          lines.push({ ...lineBase(e.date, e.adj, `Unmatched payment from ${(r as Pay).payer}`), kind: "payment", debit: ACCOUNTS.cash, credit: ACCOUNTS.suspense, amount: r.value, ...common });
        } else {
          if (INACTIVE.has(inv.status) && !replacementReceipt) flag("payment_on_inactive_invoice", "warn", num, r.txHash, `Invoice ${num} is ${inv.status} but a payment arrived.`);
          lines.push({ ...lineBase(e.date, e.adj, replacementReceipt ? `Replacement instalment ${num} from ${(r as Pay).payer}; agreement ${(r as Pay).agreementId}; date observed, original router invoice cancelled` : `Payment ${num} from ${(r as Pay).payer}`), kind: replacementReceipt ? "instalment" : "payment", debit: ACCOUNTS.cash, credit: ACCOUNTS.revenue, amount: r.value, ...common });
          if (discountHere > 0n) lines.push({ ...lineBase(e.date, e.adj, `Early-payment discount on ${num}`), kind: "early_discount", debit: ACCOUNTS.discounts, credit: ACCOUNTS.revenue, amount: discountHere, ...common });
          const tax = taxIn(r.value + discountHere, inv.taxRateBps);
          if (tax > 0n) lines.push({ ...lineBase(e.date, e.adj, `${inv.taxLabel ?? "Tax"} included in ${num}`), kind: "tax", debit: ACCOUNTS.revenue, credit: taxAccount(inv.taxLabel), amount: tax, ...common });
        }
        groups.push({ date: e.date, rank: 1, key, lines });
      } else {
        const before = paid - refunded;
        refunded += r.value;
        if (inside) { refundedIn += r.value; eventInvoices.add(invoiceId); }
        if (!inside) continue;
        bookedSourceIds.add(r.sourceKey ?? `refund:${r.id}`);
        if (paid === 0n) flag("refund_without_payment", "warn", num, r.txHash, `A refund went out for ${num ?? invoiceId.slice(0, 10)} but no payment is on record.`);
        else if (r.value > before) flag("refund_exceeds_payment", "warn", num, r.txHash, `Refunds for ${num ?? invoiceId.slice(0, 10)} add up to more than was paid.`);
        const leaf = source(r.txHash, invoiceId, r.value, "refund");
        const common = { invoice: num, invoiceId, txHash: r.txHash, leafId: leaf, currency: "USDT" as const, usdtValue: null };
        const lines: Group["lines"] = [{ ...lineBase(e.date, e.adj, `Refund ${num ?? ""} to ${(r as Ref).to}`.replace("  ", " ")), kind: "refund", debit: ACCOUNTS.refunds, credit: ACCOUNTS.cash, amount: r.value, ...common }];
        const tax = inv && !claim ? taxIn(r.value, inv.taxRateBps) : 0n;
        if (tax > 0n) lines.push({ ...lineBase(e.date, e.adj, `${inv!.taxLabel ?? "Tax"} returned on refund of ${num}`), kind: "tax", debit: taxAccount(inv!.taxLabel), credit: ACCOUNTS.refunds, amount: tax, ...common });
        groups.push({ date: e.date, rank: 2, key: `ref:${r.txHash}:${r.id}`, lines });
      }
    }
    if (!inv) return;
    seenInvoiceIds.add(invoiceId);
    const expected = expectedOf();
    const excess = paid - refunded > expected ? paid - refunded - expected : 0n;
    const state: InvoiceState = excess > 0n ? "overpaid" : paid >= expected ? "paid" : paid > 0n ? "partial" : "unpaid";
    const dead = INACTIVE.has(inv.status);
    const open = (!dead || replacement) && !claim && paid < expected ? expected - paid : 0n;
    rows.push({
      invoiceId, number: inv.number, amount: inv.amount, expected, status: inv.status, state, sold: !!claim, paidToDate: paid, refundedToDate: refunded,
      paidInPeriod: paidIn, refundedInPeriod: refundedIn, open, overpaid: excess, taxRateBps: inv.taxRateBps, taxLabel: inv.taxLabel,
    });
  };

  for (const [id, evs] of byInvoice) handle(id, evs);
  for (const inv of input.invoices) if (!byInvoice.has(inv.id)) handle(inv.id, []);

  // Per-invoice flags and which invoices belong in this month's view.
  const shown: InvoiceRow[] = [];
  for (const row of rows.sort((a, b) => a.number.localeCompare(b.number) || a.invoiceId.localeCompare(b.invoiceId))) {
    const inv = invById.get(row.invoiceId)!;
    if (inv.createdAt >= p.end) continue;
    const claim = claimsOf.get(row.invoiceId);
    const claimTouched = !!claim && ((claim.fundedAt! >= p.start && claim.fundedAt! < p.end) || (!!claim.closedAt && inPeriod(claim.closedAt)));
    const touched = eventInvoices.has(row.invoiceId) || claimTouched;
    const stillOpen = row.open > 0n;
    if (!(inPeriod(inv.createdAt) || touched || stillOpen)) continue;
    shown.push(row);
    if (row.state === "partial") flag("partial_payment", "warn", row.number, null, `${row.number} is partly paid: ${row.open} base units are still owed.`);
    if (row.state === "overpaid") flag("overpayment", "warn", row.number, null, `${row.number} was paid ${row.overpaid} base units more than it asked for.`);
    if (inv.createdAt < p.start && touched) flag("prior_period_invoice", "info", row.number, null, `${row.number} was created before this month; its payments are booked in the month they arrived.`);
    if (stillOpen && inv.dueDate && inv.dueDate < p.end) flag("past_due", "warn", row.number, null, `${row.number} was due ${inv.dueDate.slice(0, 10)} and is still unpaid.`);
  }

  // Financing: funding, the reserve coming back, or the reserve lost.
  for (const original of claimsOf.values()) {
    const fund = effective(original.fundedAt!, original.fundRecordedAt, original.fundBookedPeriod);
    const close = original.closedAt ? effective(original.closedAt, original.closeRecordedAt, original.closeBookedPeriod) : null;
    const c = { ...original, fundedAt: fund.date, closedAt: close?.date ?? null };
    const inv = invById.get(c.invoiceId);
    const num = inv?.number ?? null;
    const base = { invoice: num, invoiceId: c.invoiceId, currency: "USDT" as const, usdtValue: null };
    const advance = c.price - c.reserve;
    if (inPeriod(c.fundedAt!)) {
      bookedSourceIds.add(`fund:${c.id}:${c.fundTxHash}`);
      const common = { ...base, txHash: c.fundTxHash!, leafId: source(c.fundTxHash!, c.invoiceId, advance, "advance") };
      const lines: Group["lines"] = ([
        { ...lineBase(c.fundedAt!, fund.adjustmentFor, `Advance received for ${num ?? c.invoiceId.slice(0, 10)}`), kind: "advance", debit: ACCOUNTS.cash, credit: ACCOUNTS.revenue, amount: advance, ...common },
        { ...lineBase(c.fundedAt!, fund.adjustmentFor, `Reserve held back on ${num ?? c.invoiceId.slice(0, 10)}`), kind: "reserve_held", debit: ACCOUNTS.reserve, credit: ACCOUNTS.revenue, amount: c.reserve, ...common },
        { ...lineBase(c.fundedAt!, fund.adjustmentFor, `Financing discount on ${num ?? c.invoiceId.slice(0, 10)}`), kind: "financing_discount", debit: ACCOUNTS.financing, credit: ACCOUNTS.revenue, amount: c.face - c.price, ...common },
      ] satisfies Group["lines"]).filter((l) => l.amount > 0n);
      const tax = inv ? taxIn(c.face, inv.taxRateBps) : 0n;
      if (tax > 0n) lines.push({ ...lineBase(c.fundedAt!, fund.adjustmentFor, `${inv!.taxLabel ?? "Tax"} included in ${num}`), kind: "tax", debit: ACCOUNTS.revenue, credit: taxAccount(inv!.taxLabel), amount: tax, ...common });
      groups.push({ date: c.fundedAt!, rank: 3, key: `fund:${c.id}`, lines });
    }
    if (c.closedAt && c.closeTxHash && inPeriod(c.closedAt) && c.reserve > 0n && (c.status === "settled" || c.status === "defaulted")) {
      bookedSourceIds.add(`close:${c.id}:${c.closeTxHash}`);
      const settled = c.status === "settled";
      const kind = settled ? "reserve_release" : "reserve_forfeit";
      const common = { ...base, txHash: c.closeTxHash, leafId: source(c.closeTxHash, c.invoiceId, c.reserve, kind) };
      if (!settled) flag("default_reserve_unverified", "warn", num, c.closeTxHash, `${num ?? "An invoice"} defaulted. The whole reserve is booked as forfeited; check on the explorer how much actually went to the investor.`);
      groups.push({
        date: c.closedAt, rank: 4, key: `close:${c.id}`,
        lines: [settled
          ? { ...lineBase(c.closedAt, close?.adjustmentFor ?? null, `Reserve returned on ${num ?? c.invoiceId.slice(0, 10)}`), kind, debit: ACCOUNTS.cash, credit: ACCOUNTS.reserve, amount: c.reserve, ...common }
          : { ...lineBase(c.closedAt, close?.adjustmentFor ?? null, `Reserve forfeited on ${num ?? c.invoiceId.slice(0, 10)}`), kind, debit: ACCOUNTS.forfeited, credit: ACCOUNTS.reserve, amount: c.reserve, ...common }],
      });
    }
  }

  // Gas: a separate expense, in WBT.
  let gasWei = 0n;
  let gasUsdt: bigint | null = input.gasRate ? 0n : null;
  for (const original of input.gas) {
    const date = effective(original.at, original.recordedAt, original.bookedPeriod);
    const g = { ...original, at: date.date };
    if (!g.txHash || g.wei <= 0n || !inPeriod(g.at)) continue;
    bookedSourceIds.add(g.sourceKey ?? `gas:${g.id}`);
    const usdtValue = input.gasRate ? (g.wei * input.gasRate.usdtPerWbt) / WEI : null;
    gasWei += g.wei;
    if (usdtValue !== null) gasUsdt = (gasUsdt ?? 0n) + usdtValue;
    groups.push({
      date: g.at, rank: 5, key: `gas:${g.txHash}:${g.id}`,
      lines: [{ ...lineBase(g.at, date.adjustmentFor, `Network fee for ${g.kind.replaceAll("_", " ")}`), kind: "gas", invoice: null, invoiceId: null, debit: ACCOUNTS.gas, credit: ACCOUNTS.tank, amount: g.wei, currency: "WBT", usdtValue, txHash: g.txHash, leafId: source(g.txHash, null, g.wei, "gas") }],
    });
  }
  if (gasWei > 0n && !input.gasRate) flag("gas_unconverted", "info", null, null, "Gas is shown in WBT. No exchange rate was supplied, so it is not converted to dollars.");

  groups.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.key.localeCompare(b.key));
  const lines: Line[] = groups.flatMap((g) => g.lines).map((l, i) => ({ ...l, seq: i + 1 }));

  const tb = new Map<string, { account: string; currency: "USDT" | "WBT"; debit: bigint; credit: bigint }>();
  const touch = (account: string | null, currency: "USDT" | "WBT") => {
    const k = `${currency}|${account}`;
    return tb.get(k) ?? tb.set(k, { account: account!, currency, debit: 0n, credit: 0n }).get(k)!;
  };
  for (const l of lines) {
    if (l.debit) touch(l.debit, l.currency).debit += l.amount;
    if (l.credit) touch(l.credit, l.currency).credit += l.amount;
  }
  const leaves = [...sources.values()].sort((a, b) => a.leafId.localeCompare(b.leafId));
  flags.sort((a, b) => a.code.localeCompare(b.code) || (a.invoice ?? "").localeCompare(b.invoice ?? "") || (a.txHash ?? "").localeCompare(b.txHash ?? ""));
  return {
    period: input.period, bookedSourceIds: [...bookedSourceIds].sort(), lines, invoices: shown, flags, leaves,
    trialBalance: [...tb.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.account.localeCompare(b.account)),
    gasWei, gasUsdt, gasRateSource: input.gasRate?.source ?? null,
  };
}
