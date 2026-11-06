import { toUnits } from "@stenmont/shared";
import { formatAmount } from "../lib/pay";

export type Invoice = {
  id: string;
  contractVersion?: "v1" | "v2";
  discountBps?: number;
  discountUntil?: number | null;
  payerLock?: string | null;
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
  warn: "bg-warn text-white",
  bad: "bg-danger text-white",
  off: "bg-line text-navy",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-6 ${className}`}>
      {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p data-testid={testId} className="amount mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

/** The title block every dashboard page starts with: what this page is, in a sentence, and its one main action. */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/** Says what is missing and offers the one next step. `action` is a link or button the caller supplies. */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-line p-6" data-testid="empty-state">
      <h3 className="font-bold">{title}</h3>
      {description && <p className="max-w-xl text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

/** A loading or failure line that screen readers announce without moving focus. */
export function PageNotice({ kind, children }: { kind: "loading" | "error"; children: React.ReactNode }) {
  return kind === "error"
    ? <p role="alert" className="text-danger">{children}</p>
    : <p role="status" aria-busy="true" className="text-muted">{children}</p>;
}

export const actionLink = "inline-flex min-h-11 items-center rounded border border-foreground bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2";
export const secondaryLink = "inline-flex min-h-11 items-center rounded border border-line px-4 text-sm font-medium hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2";
