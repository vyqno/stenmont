import { describe, expect, it } from "vitest";
import { periodBounds, periodOf, reconcile, type Claim, type Gas, type Inv, type Input, type Pay, type Ref } from "../../src/books/reconcile";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const ID = (n: number) => `0x${"a".repeat(60)}${n.toString(16).padStart(4, "0")}`;
const U = (d: string) => BigInt(Math.round(Number(d) * 1e6));

const inv = (n: number, amount: string, over: Partial<Inv> = {}): Inv => ({
  id: ID(n), number: `INV-${n}`, amount: U(amount), status: "open", taxRateBps: null, taxLabel: null, dueDate: null,
  createdAt: "2026-11-01T00:00:00.000Z", createTxHash: H(900 + n), earlyDiscount: null, ...over,
});
const pay = (n: number, invN: number, value: string, at: string, over: Partial<Pay> = {}): Pay => ({
  id: `p${n}`, invoiceId: ID(invN), payer: "0x2222222222222222222222222222222222222222", value: U(value), txHash: H(n), blockNumber: n, at, recordedAt: at, ...over,
});
const ref = (n: number, invN: number, value: string, at: string, over: Partial<Ref> = {}): Ref => ({
  id: `r${n}`, invoiceId: ID(invN), to: "0x2222222222222222222222222222222222222222", value: U(value), txHash: H(n), blockNumber: n, at, recordedAt: at, ...over,
});
const run = (over: Partial<Input>) => reconcile({ period: "2026-11", invoices: [], payments: [], refunds: [], claims: [], gas: [], ...over });
const codes = (r: ReturnType<typeof run>) => r.flags.map((f) => f.code).sort();
const bal = (r: ReturnType<typeof run>, account: string) => {
  const t = r.trialBalance.find((x) => x.account === account);
  return t ? { debit: t.debit, credit: t.credit } : { debit: 0n, credit: 0n };
};

describe("periods", () => {
  it("parses a month and its bounds, and finds the month of a date", () => {
    expect(periodBounds("2026-11")).toEqual({ id: "2026-11", start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" });
    expect(periodBounds("2026-12").end).toBe("2027-01-01T00:00:00.000Z");
    expect(periodOf("2026-11-30T23:59:59.999Z")).toBe("2026-11");
    expect(() => periodBounds("2026-13")).toThrow();
    expect(() => periodBounds("2026-1")).toThrow();
  });
});

describe("a plain paid invoice", () => {
  const r = run({ invoices: [inv(1, "10", { status: "paid" })], payments: [pay(1, 1, "10", "2026-11-02T10:00:00.000Z")] });
  it("books cash against revenue with debit and credit", () => {
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ seq: 1, kind: "payment", invoice: "INV-1", debit: "Cash (USDT)", credit: "Sales revenue", amount: 10_000_000n, currency: "USDT", txHash: H(1) });
    expect(codes(r)).toEqual([]);
    expect(r.invoices[0]).toMatchObject({ number: "INV-1", state: "paid", paidToDate: 10_000_000n, open: 0n });
  });
  it("has one leaf that the line points at, and balances", () => {
    expect(r.leaves).toHaveLength(1);
    expect(r.leaves[0]).toMatchObject({ txHash: H(1), invoiceId: ID(1), amount: 10_000_000n, kind: "payment" });
    expect(r.lines[0]!.leafId).toMatch(/^0x[0-9a-f]{64}$/);
    for (const t of r.trialBalance) expect(t.currency).toBe("USDT");
    expect(r.trialBalance.reduce((s, t) => s + t.debit - t.credit, 0n)).toBe(0n);
  });
});

describe("matching problems are flagged, not hidden", () => {
  it("partial payment: open balance stays and the invoice is flagged", () => {
    const r = run({ invoices: [inv(1, "10", { status: "partially_paid" })], payments: [pay(1, 1, "4", "2026-11-02T00:00:00.000Z")] });
    expect(r.invoices[0]).toMatchObject({ state: "partial", paidToDate: 4_000_000n, open: 6_000_000n });
    expect(codes(r)).toEqual(["partial_payment"]);
  });
  it("two partial payments across the month add up to paid", () => {
    const r = run({ invoices: [inv(1, "10", { status: "paid" })], payments: [pay(1, 1, "4", "2026-11-02T00:00:00.000Z"), pay(2, 1, "6", "2026-11-09T00:00:00.000Z")] });
    expect(r.invoices[0]!.state).toBe("paid");
    expect(codes(r)).toEqual([]);
    expect(r.lines.map((l) => l.amount)).toEqual([4_000_000n, 6_000_000n]);
  });
  it("overpayment", () => {
    const r = run({ invoices: [inv(1, "10", { status: "paid" })], payments: [pay(1, 1, "12.5", "2026-11-02T00:00:00.000Z")] });
    expect(r.invoices[0]).toMatchObject({ state: "overpaid", open: 0n, overpaid: 2_500_000n });
    expect(codes(r)).toEqual(["overpayment"]);
  });
  it("payment for an invoice we do not know goes to suspense", () => {
    const r = run({ payments: [pay(1, 7, "3", "2026-11-02T00:00:00.000Z")] });
    expect(codes(r)).toEqual(["payment_without_invoice"]);
    expect(r.lines[0]).toMatchObject({ debit: "Cash (USDT)", credit: "Suspense (unmatched)", invoice: null });
  });
  it("payment on a cancelled invoice is booked and flagged", () => {
    const r = run({ invoices: [inv(1, "10", { status: "cancelled" })], payments: [pay(1, 1, "10", "2026-11-02T00:00:00.000Z")] });
    expect(codes(r)).toContain("payment_on_inactive_invoice");
  });
  it("refund with no payment at all, and refund larger than what was paid", () => {
    const a = run({ invoices: [inv(1, "10")], refunds: [ref(1, 1, "2", "2026-11-03T00:00:00.000Z")] });
    expect(codes(a)).toEqual(["refund_without_payment"]);
    const b = run({ invoices: [inv(1, "10", { status: "paid" })], payments: [pay(1, 1, "10", "2026-11-02T00:00:00.000Z")], refunds: [ref(2, 1, "6", "2026-11-03T00:00:00.000Z"), ref(3, 1, "5", "2026-11-04T00:00:00.000Z")] });
    expect(codes(b)).toEqual(["refund_exceeds_payment"]);
  });
  it("multiple refunds within what was paid are fine, and reduce what is net received", () => {
    const r = run({ invoices: [inv(1, "10", { status: "paid" })], payments: [pay(1, 1, "10", "2026-11-02T00:00:00.000Z")], refunds: [ref(2, 1, "3", "2026-11-03T00:00:00.000Z"), ref(3, 1, "2", "2026-11-04T00:00:00.000Z")] });
    expect(codes(r)).toEqual([]);
    expect(r.invoices[0]).toMatchObject({ refundedToDate: 5_000_000n, refundedInPeriod: 5_000_000n });
    expect(r.lines.filter((l) => l.kind === "refund").map((l) => [l.debit, l.credit, l.amount])).toEqual([
      ["Refunds to customers", "Cash (USDT)", 3_000_000n],
      ["Refunds to customers", "Cash (USDT)", 2_000_000n],
    ]);
  });
  it("zero-amount payments are flagged and make no ledger line or leaf", () => {
    const r = run({ invoices: [inv(1, "10")], payments: [pay(1, 1, "0", "2026-11-02T00:00:00.000Z")] });
    expect(codes(r)).toContain("zero_amount");
    expect(r.lines).toHaveLength(0);
    expect(r.leaves).toHaveLength(0);
  });
  it("an unpaid invoice past its due date is flagged", () => {
    const r = run({ invoices: [inv(1, "10", { dueDate: "2026-11-15T00:00:00.000Z" })] });
    expect(codes(r)).toEqual(["past_due"]);
    expect(r.invoices[0]).toMatchObject({ state: "unpaid", open: 10_000_000n });
  });
});

describe("periods and cross-period payments", () => {
  it("a payment in the period for an October invoice is matched, and earlier payments count toward paid", () => {
    const r = run({
      invoices: [inv(1, "10", { status: "paid", createdAt: "2026-10-01T00:00:00.000Z" })],
      payments: [pay(1, 1, "4", "2026-10-20T00:00:00.000Z"), pay(2, 1, "6", "2026-11-03T00:00:00.000Z")],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.invoices[0]).toMatchObject({ state: "paid", paidToDate: 10_000_000n, paidInPeriod: 6_000_000n });
    expect(codes(r)).toEqual(["prior_period_invoice"]);
  });
  it("events after the period end do not count", () => {
    const r = run({ invoices: [inv(1, "10")], payments: [pay(1, 1, "10", "2026-12-01T00:00:00.000Z")] });
    expect(r.lines).toHaveLength(0);
    expect(r.invoices[0]!.state).toBe("unpaid");
  });
  it("the first and last instants of the month are inside it", () => {
    const r = run({ invoices: [inv(1, "10")], payments: [pay(1, 1, "1", "2026-11-01T00:00:00.000Z"), pay(2, 1, "1", "2026-11-30T23:59:59.999Z"), pay(3, 1, "1", "2026-10-31T23:59:59.999Z")] });
    expect(r.lines.map((l) => l.txHash)).toEqual([H(1), H(2)]);
  });
  it("a back-dated event for a closed month becomes an adjustment line in the month it was recorded", () => {
    const events = { invoices: [inv(1, "10", { status: "paid", createdAt: "2026-10-01T00:00:00.000Z" })], payments: [pay(1, 1, "10", "2026-10-30T00:00:00.000Z", { recordedAt: "2026-11-03T00:00:00.000Z" })] };
    const closed = { "2026-10": "2026-11-01T00:00:00.000Z" };
    const oct = reconcile({ period: "2026-10", ...events, refunds: [], claims: [], gas: [], closedPeriods: closed });
    expect(oct.lines).toHaveLength(0);
    const nov = reconcile({ period: "2026-11", ...events, refunds: [], claims: [], gas: [], closedPeriods: closed });
    expect(nov.lines).toHaveLength(1);
    expect(nov.lines[0]).toMatchObject({ adjustmentFor: "2026-10", date: "2026-11-03T00:00:00.000Z" });
    expect(nov.lines[0]!.description).toMatch(/^Adjustment for 2026-10/);
  });
  it("without a close on record, a back-dated event stays in its own month", () => {
    const r = reconcile({ period: "2026-10", invoices: [inv(1, "10")], payments: [pay(1, 1, "10", "2026-10-30T00:00:00.000Z", { recordedAt: "2026-11-03T00:00:00.000Z" })], refunds: [], claims: [], gas: [] });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.adjustmentFor).toBeNull();
  });
});

describe("tax and discount lines", () => {
  it("splits the tax that is included in what was paid, and reverses it on a refund", () => {
    const r = run({
      invoices: [inv(1, "120", { status: "paid", taxRateBps: 2000, taxLabel: "VAT" })],
      payments: [pay(1, 1, "120", "2026-11-02T00:00:00.000Z")],
      refunds: [ref(2, 1, "60", "2026-11-03T00:00:00.000Z")],
    });
    const tax = r.lines.filter((l) => l.kind === "tax");
    expect(tax.map((l) => [l.debit, l.credit, l.amount])).toEqual([
      ["Sales revenue", "Tax payable (VAT)", 20_000_000n],
      ["Tax payable (VAT)", "Refunds to customers", 10_000_000n],
    ]);
    expect(bal(r, "Tax payable (VAT)")).toEqual({ debit: 10_000_000n, credit: 20_000_000n });
  });
  it("rounds tax down to the smallest unit", () => {
    const r = run({ invoices: [inv(1, "0.000007", { status: "paid", taxRateBps: 1000, taxLabel: "GST" })], payments: [pay(1, 1, "0.000007", "2026-11-02T00:00:00.000Z")] });
    expect(r.lines.find((l) => l.kind === "tax")).toBeUndefined(); // floor(7 * 1000 / 11000) = 0, so no line
  });
  it("early-payment discount is its own line when the invoice is settled on time", () => {
    const base = { status: "paid", earlyDiscount: { bps: 200, until: "2026-11-10T00:00:00.000Z" } };
    const r = run({ invoices: [inv(1, "100", base)], payments: [pay(1, 1, "98", "2026-11-05T00:00:00.000Z")] });
    expect(r.lines.map((l) => [l.kind, l.debit, l.credit, l.amount])).toEqual([
      ["payment", "Cash (USDT)", "Sales revenue", 98_000_000n],
      ["early_discount", "Sales discounts", "Sales revenue", 2_000_000n],
    ]);
    expect(r.invoices[0]).toMatchObject({ state: "paid", open: 0n });
    expect(codes(r)).toEqual([]);
  });
  it("paying the discounted amount after the deadline is a partial payment, with no discount line", () => {
    const base = { earlyDiscount: { bps: 200, until: "2026-11-10T00:00:00.000Z" } };
    const r = run({ invoices: [inv(1, "100", base)], payments: [pay(1, 1, "98", "2026-11-12T00:00:00.000Z")] });
    expect(r.lines.some((l) => l.kind === "early_discount")).toBe(false);
    expect(codes(r)).toContain("partial_payment");
  });
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "cl_1", invoiceId: ID(1), status: "funded", face: U("100"), price: U("95"), reserve: U("10"),
  fundTxHash: H(50), closeTxHash: null, fundedAt: "2026-11-04T00:00:00.000Z", closedAt: null, ...over,
});

describe("financing", () => {
  it("a funded invoice: advance, reserve held and the financing discount are separate lines that balance", () => {
    const r = run({ invoices: [inv(1, "100", { status: "open" })], claims: [claim()] });
    expect(r.lines.map((l) => [l.kind, l.debit, l.credit, l.amount])).toEqual([
      ["advance", "Cash (USDT)", "Sales revenue", 85_000_000n],
      ["reserve_held", "Reserve held by investor contract", "Sales revenue", 10_000_000n],
      ["financing_discount", "Financing discount", "Sales revenue", 5_000_000n],
    ]);
    expect(bal(r, "Sales revenue").credit).toBe(100_000_000n);
    expect(r.leaves.map((l) => [l.kind, l.amount, l.txHash])).toEqual([["advance", 85_000_000n, H(50)]]);
  });
  it("tax on a sold invoice is taken on the face value once, and later payments to the investor are memo lines", () => {
    const r = run({
      invoices: [inv(1, "100", { status: "paid", taxRateBps: 2000, taxLabel: "VAT" })],
      claims: [claim()],
      payments: [pay(2, 1, "100", "2026-11-20T00:00:00.000Z")],
    });
    expect(r.lines.find((l) => l.kind === "tax")!.amount).toBe(16_666_666n);
    const memo = r.lines.find((l) => l.kind === "payment_to_investor")!;
    expect(memo).toMatchObject({ debit: null, credit: null, amount: 100_000_000n });
    expect(bal(r, "Cash (USDT)").debit).toBe(85_000_000n);
  });
  it("settlement releases the reserve to cash", () => {
    const r = run({ invoices: [inv(1, "100", { status: "paid" })], claims: [claim({ status: "settled", closeTxHash: H(60), closedAt: "2026-11-25T00:00:00.000Z" })] });
    const rel = r.lines.find((l) => l.kind === "reserve_release")!;
    expect(rel).toMatchObject({ debit: "Cash (USDT)", credit: "Reserve held by investor contract", amount: 10_000_000n, txHash: H(60) });
    expect(r.leaves.map((l) => l.kind)).toContain("reserve_release");
  });
  it("a default is booked as forfeited reserve and flagged for a check on the explorer", () => {
    const r = run({ invoices: [inv(1, "100")], claims: [claim({ status: "defaulted", closeTxHash: H(61), closedAt: "2026-11-25T00:00:00.000Z" })] });
    expect(r.lines.find((l) => l.kind === "reserve_forfeit")).toMatchObject({ debit: "Reserve forfeited", credit: "Reserve held by investor contract", amount: 10_000_000n });
    expect(codes(r)).toContain("default_reserve_unverified");
  });
  it("a funding in October with settlement in November puts each step in its own month", () => {
    const c = claim({ status: "settled", fundedAt: "2026-10-28T00:00:00.000Z", closeTxHash: H(60), closedAt: "2026-11-02T00:00:00.000Z" });
    const r = run({ invoices: [inv(1, "100")], claims: [c] });
    expect(r.lines.map((l) => l.kind)).toEqual(["reserve_release"]);
  });
});

describe("gas", () => {
  const gas: Gas[] = [
    { id: "g1", txHash: H(70), kind: "pay", wei: 2_000_000_000_000_000n, at: "2026-11-03T00:00:00.000Z" },
    { id: "g2", txHash: H(71), kind: "create_invoice", wei: 500_000_000_000_000n, at: "2026-11-03T00:00:01.000Z" },
  ];
  it("is a separate expense line in WBT, marked unconverted, with no invented rate", () => {
    const r = run({ gas });
    expect(r.lines.map((l) => [l.kind, l.debit, l.credit, l.amount, l.currency, l.usdtValue])).toEqual([
      ["gas", "Network fees (gas)", "Gas tank (WBT)", 2_000_000_000_000_000n, "WBT", null],
      ["gas", "Network fees (gas)", "Gas tank (WBT)", 500_000_000_000_000n, "WBT", null],
    ]);
    expect(codes(r)).toEqual(["gas_unconverted"]);
    expect(r.gasWei).toBe(2_500_000_000_000_000n);
    expect(r.gasUsdt).toBeNull();
  });
  it("converts for display only when a rate is supplied, and says where it came from", () => {
    const r = run({ gas, gasRate: { usdtPerWbt: U("2"), source: "manual entry" } });
    expect(r.lines.map((l) => l.usdtValue)).toEqual([4_000n, 1_000n]); // 0.002 WBT * 2 = 0.004 USDT
    expect(r.gasUsdt).toBe(5_000n);
    expect(r.gasRateSource).toBe("manual entry");
    expect(codes(r)).toEqual([]);
    expect(r.lines[0]!.amount).toBe(2_000_000_000_000_000n); // the book amount stays in WBT
  });
  it("ignores gas outside the month, and unsent transactions", () => {
    const r = run({ gas: [{ ...gas[0]!, at: "2026-10-31T23:59:59.999Z" }, { ...gas[1]!, txHash: null }] });
    expect(r.lines).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("the same inputs in any order give the same lines, sequence and leaves", () => {
    const input = {
      invoices: [inv(1, "10", { status: "paid", taxRateBps: 1000, taxLabel: "VAT" }), inv(2, "5", { status: "paid" })],
      payments: [pay(1, 1, "10", "2026-11-02T00:00:00.000Z"), pay(2, 2, "5", "2026-11-02T00:00:00.000Z"), pay(3, 2, "0", "2026-11-02T00:00:00.000Z")],
      refunds: [ref(4, 2, "1", "2026-11-02T00:00:00.000Z")],
    };
    const a = run(input);
    const b = run({ invoices: [...input.invoices].reverse(), payments: [...input.payments].reverse(), refunds: [...input.refunds].reverse() });
    expect(JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(a.lines.map((l) => l.seq)).toEqual(a.lines.map((_, i) => i + 1));
  });
});

it("moves late gas and financing sources out of a locked interim month",()=>{
 const closedPeriods={"2026-11":"2026-11-06T12:00:00.000Z"};
 const c:Claim={id:"c_late",invoiceId:ID(1),status:"settled",face:10_000_000n,price:9_000_000n,reserve:1_000_000n,fundTxHash:H(81),closeTxHash:H(82),fundedAt:"2026-11-04T00:00:00.000Z",closedAt:"2026-11-05T00:00:00.000Z",fundRecordedAt:"2026-11-07T00:00:00.000Z",closeRecordedAt:"2026-11-07T00:00:00.000Z"};
 const r=run({period:"2026-12",closedPeriods,invoices:[inv(1,"10")],claims:[c],gas:[{id:"g_late",txHash:H(83),kind:"pay",wei:1n,at:"2026-11-05T00:00:00.000Z",recordedAt:"2026-11-07T00:00:00.000Z"}]});
 expect(r.lines.map(l=>l.kind)).toEqual(["advance","reserve_held","financing_discount","reserve_release","gas"]);
 expect(r.lines.every(l=>l.adjustmentFor==="2026-11")).toBe(true);
});

it("never rebooks a November adjustment in December after November closes",()=>{
 const source=pay(99,1,"4","2026-10-25T00:00:00.000Z",{recordedAt:"2026-11-03T00:00:00.000Z"});
 const base={invoices:[inv(1,"10",{createdAt:"2026-10-01T00:00:00.000Z"})],payments:[source],closedPeriods:{"2026-10":"2026-11-01T00:00:00.000Z","2026-11":"2026-12-01T00:00:00.000Z"}};
 expect(run({...base,period:"2026-11"}).lines).toHaveLength(1);
 expect(run({...base,period:"2026-12"}).lines).toHaveLength(0);
});
