import type { Summary } from "../../lib/account";
import { formatAmount } from "../../lib/pay";

/** Actual receipt display only. Replacement payments never imply a router refund or cancellation action. */
export function PaymentReceipts({ payments }: { payments: Summary["payments"] }) {
  return <ul className="divide-y divide-line" data-testid="payments">
    {payments.map((p, index) => <li key={`${p.receiptUrl}:${index}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div>
        <p className="font-medium">{p.merchantName}</p>
        {p.rail === "replacement_subscription" && <p className="text-sm font-medium">Replacement plan payment</p>}
        <p className="text-sm text-muted">Invoice {p.invoiceNumber} · {p.timeBasis === "observed" ? "Receipt recorded " : ""}{new Date(p.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
      </div>
      <div className="text-right">
        <p>{formatAmount(p.amount)}</p>
        <a className="text-sm underline" href={p.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>
      </div>
    </li>)}
  </ul>;
}
