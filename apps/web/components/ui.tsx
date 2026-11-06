import { toUnits } from "@stenmont/shared";
import { formatAmount } from "../lib/pay";

export type Invoice = {
  id: string;
  number: string;
  status: "open" | "partially_paid" | "paid" | "cancelled" | "failed";
  amount: string;
  amountPaid: string;
  amountRefunded: string;
  customerEmail: string | null;
  dueDate: string | null;
  payUrl: string;
  createdAt: string;
};

export const money = (v: string) => formatAmount(v);
export const units = (v: string) => toUnits(v);

/** What the business sees: refunds change the label, because "paid" alone would hide money that went back. */
export function statusOf(i: Invoice, now = Date.now()): { label: string; tone: "ok" | "wait" | "warn" | "bad" | "off" } {
  const paid = toUnits(i.amountPaid);
  const refunded = toUnits(i.amountRefunded);
  if (refunded > 0n) return { label: refunded >= paid ? "Refunded" : "Partly refunded", tone: "off" };
  if (i.status === "paid") return { label: "Paid", tone: "ok" };
  if (i.status === "partially_paid") return { label: "Partly paid", tone: "wait" };
  if (i.status === "cancelled") return { label: "Cancelled", tone: "off" };
  if (i.status === "failed") return { label: "Failed", tone: "bad" };
  if (i.dueDate && Date.parse(i.dueDate) < now) return { label: "Overdue", tone: "warn" };
  return { label: "Open", tone: "wait" };
}

const TONES = {
  ok: "bg-mint text-navy",
  wait: "bg-surface text-foreground border border-line",
  warn: "bg-warn text-navy",
  bad: "bg-danger text-white",
  off: "bg-line text-navy",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>
      {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p data-testid={testId} className="amount mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
