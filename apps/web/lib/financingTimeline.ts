import { explorerTx } from "./financing";
import { formatAmount } from "./pay";

/** One financed invoice, as `GET /v1/financing/timeline` returns it. Money is a decimal string in dollars. */
export type TimelineItem = {
  claimId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  status: string; // listed | funding | funded | settled | defaulted | cancelled
  showInvoiceNumber: boolean;
  face: string;
  price: string;
  discount: string;
  reserve: string;
  advance: string;
  discountBps: number;
  reserveBps: number;
  amountPaid: string;
  dueDate: string;
  fundBy: string;
  investor: { address: string; verified: boolean; verifiedAt: string | null; allowTx: string | null } | null;
  times: { listedAt: string | null; fundedAt: string | null; closedAt: string | null };
  transactions: { list: string | null; fund: string | null; close: string | null };
  payments: { value: string; txHash: string; at: string }[];
};

export type StepKey = "listed" | "investor" | "funded" | "payment" | "close";
export type StepState = "done" | "current" | "waiting" | "failed" | "skipped";
export type Step = {
  key: StepKey;
  title: string;
  state: StepState;
  at: string | null;
  txHash: string | null;
  url: string | null;
  facts: { label: string; value: string }[];
};

/** The contract gives the customer this long after the due date before anyone may mark the claim as defaulted. */
export const GRACE_DAYS = 7;
const DAY = 86_400_000;

/** What each step means for the business, in plain words (the explanation panel). */
export const STEP_EXPLANATIONS: Record<StepKey, string> = {
  listed: "You offered this unpaid invoice to investors at a discount. Nothing is paid yet, and until someone buys it you can still be paid by your customer as usual.",
  investor: "Only people who proved they are real, with World, are allowed to buy. The approval is recorded on the blockchain, so the list of buyers cannot be edited quietly.",
  funded: "An approved investor bought the invoice. You receive the cash today, the discounted price minus a small part we hold back until your customer pays.",
  payment: "Your customer pays the invoice as normal. The money goes straight to the investor, and the contract keeps count, so nobody has to chase or reconcile anything.",
  close: "When the investor has been repaid in full, the held-back amount comes back to you. If the customer has not paid a week after the due date, the held-back amount goes to the investor instead and you keep the cash you already received.",
};

const money = (v: string) => formatAmount(v);
const pctOf = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
const tx = (hash: string | null) => ({ txHash: hash, url: hash ? explorerTx(hash) : null });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "0x1234…abcd" */
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const parts = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : new Date(t);
};
/** "6 Nov 2026, 10:01 UTC", the same everywhere. */
export function formatWhen(iso: string | null): string {
  const d = parts(iso);
  if (!d) return "Not recorded";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${d.toISOString().slice(11, 16)} UTC`;
}
export const formatDay = (iso: string | number) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const certificateUrl = (origin: string, invoiceId: string) => `${origin}/claim/${invoiceId}`;

const SOLD = ["funded", "settled", "defaulted"];
const afterList = (s: string) => s !== "cancelled" && s !== "pending";

/** The five steps of one financed invoice, each with its state, time, transaction link and amounts. Pure: `now` is a parameter. */
export function buildSteps(i: TimelineItem, now = Date.now()): Step[] {
  const cancelled = i.status === "cancelled";
  const inFunding = i.status === "funding";
  const sold = SOLD.includes(i.status);
  const hasBuyer = sold || inFunding;
  const paidAll = Number(i.amountPaid) >= Number(i.face) && Number(i.face) > 0;
  const due = Date.parse(i.dueDate);
  const lastPayment = i.payments.at(-1) ?? null;
  const skip = (state: StepState): StepState => (cancelled ? "skipped" : state);

  const listed: Step = {
    key: "listed", title: "Listed for investors", state: afterList(i.status) || cancelled ? "done" : "waiting", at: i.times.listedAt, ...tx(i.transactions.list),
    facts: [
      { label: "Invoice value", value: money(i.face) },
      { label: "Offer price", value: money(i.price) },
      { label: "Discount", value: `${money(i.discount)} (${pctOf(i.discountBps)})` },
      { label: "Held back", value: money(i.reserve) },
    ],
  };

  const investorFacts: Step["facts"] = [];
  if (i.investor) {
    investorFacts.push({ label: "Investor", value: shortAddr(i.investor.address) });
    investorFacts.push({ label: "Identity", value: i.investor.verified ? "Verified as a real person with World" : "No World proof recorded (approved directly by Stenmont)" });
  } else if (!cancelled) {
    investorFacts.push({ label: "Waiting for", value: `an approved investor, until ${formatDay(i.fundBy)}` });
  }
  const investor: Step = {
    key: "investor", title: "Investor verified", state: hasBuyer ? "done" : skip("current"), at: i.investor?.verifiedAt ?? null, ...tx(i.investor?.allowTx ?? null), facts: investorFacts,
  };

  const funded: Step = {
    key: "funded", title: "Investor funds it", state: sold ? "done" : inFunding ? "current" : skip("waiting"), at: i.times.fundedAt, ...tx(i.transactions.fund),
    facts: sold || inFunding
      ? [
          { label: "Cash received today", value: money(i.advance) },
          { label: "Investor paid", value: money(i.price) },
          { label: "Held until the customer pays", value: money(i.reserve) },
        ]
      : [{ label: "You will receive", value: `${money(i.advance)} today once it is bought` }],
  };

  const overdueDays = Math.floor((now - due) / DAY);
  const paymentFacts: Step["facts"] = [
    { label: "Due", value: formatDay(i.dueDate) },
    { label: "Paid so far", value: money(i.amountPaid) },
  ];
  if (i.status === "funded" && overdueDays >= 1) paymentFacts.push({ label: "Status", value: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}` });
  const payment: Step = {
    key: "payment", title: i.status === "defaulted" && !paidAll ? "Customer has not paid" : "Customer pays",
    state: paidAll || i.status === "settled" ? "done" : i.status === "defaulted" ? "failed" : i.status === "funded" ? "current" : skip("waiting"),
    at: lastPayment?.at ?? null, ...tx(lastPayment?.txHash ?? null), facts: paymentFacts,
  };

  const graceEnd = due + GRACE_DAYS * DAY;
  const closeFacts: Step["facts"] =
    i.status === "settled"
      ? [
          { label: "Investor repaid", value: money(i.face) },
          { label: "Investor's profit", value: money(i.discount) },
          { label: "Reserve returned to you", value: money(i.reserve) },
          { label: "You received in total", value: money(i.price) },
        ]
      : i.status === "defaulted"
        ? [
            { label: "Reserve paid to the investor", value: money(i.reserve) },
            { label: "You keep", value: money(i.advance) },
          ]
        : sold && Number.isFinite(graceEnd)
          ? [{ label: "Default possible after", value: formatDay(graceEnd) }]
          : [];
  const close: Step = {
    key: "close", title: cancelled ? "Not sold" : i.status === "defaulted" ? "Defaulted" : i.status === "settled" ? "Settled" : "Settled or defaulted",
    state: i.status === "settled" ? "done" : i.status === "defaulted" ? "failed" : skip("waiting"), at: i.times.closedAt, ...tx(i.transactions.close), facts: closeFacts,
  };

  return [listed, investor, funded, payment, close];
}

/** The step the business is waiting on, or null when the story is over. */
export function currentStep(i: TimelineItem): StepKey | null {
  return buildSteps(i).find((s) => s.state === "current")?.key ?? null;
}
