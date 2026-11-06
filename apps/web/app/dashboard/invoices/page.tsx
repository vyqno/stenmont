"use client";

import { useState } from "react";
import { Badge, Card, money, statusOf, units, type Invoice } from "../../../components/ui";
import { ExportButton } from "../../../components/ExportButton";
import { RefundButton } from "../../../components/RefundButton";
import { SellButton } from "../../../components/SellButton";
import { listingBadge } from "../../../lib/financing";
import { AuthError, api } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";

export default function Invoices() {
  const { data, error, reload } = useApi<{ data: Invoice[] }>("/v1/invoices?limit=100");
  const { data: listings, reload: reloadListings } = useApi<{ listings: { invoiceId: string; status: string }[] }>("/v1/financing/listings");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState("");
  const [now] = useState(() => Date.now());
  // World sends the person back here after the approval: tell them what happened.
  const [approvalResult] = useState<"approved" | "denied" | null>(() => {
    const r = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("result");
    return r === "approved" || r === "denied" ? r : null;
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await api.post("/v1/invoices", {
        amount,
        ...(email ? { customerEmail: email } : {}),
        ...(due ? { dueDate: new Date(`${due}T23:59:59Z`).toISOString() } : {}),
      });
      setAmount("");
      setEmail("");
      setDue("");
      reload();
    } catch (err) {
      setFormError(err instanceof AuthError ? err.message : "The invoice could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const copy = (i: Invoice) => navigator.clipboard.writeText(i.payUrl).then(() => setCopied(i.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Invoices</h1>
        <ExportButton />
      </div>

      {approvalResult && (
        <p role="status" data-testid="approval-result" className={approvalResult === "approved" ? "rounded border border-mint p-3 text-sm" : "rounded border border-danger p-3 text-sm text-danger"}>
          {approvalResult === "approved" ? "Approved. Press Refund again to finish the refund." : "The approval was not completed, so the refund was not sent."}
        </p>
      )}

      <Card title="New invoice">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1 text-sm">
            Amount (USD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" placeholder="250.00" className="amount rounded border border-line bg-transparent px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Customer email (optional)
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" className="rounded border border-line bg-transparent px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Due date (optional)
            <input value={due} onChange={(e) => setDue(e.target.value)} type="date" className="rounded border border-line bg-transparent px-3 py-2 text-base" />
          </label>
          <button disabled={busy} className="rounded bg-brand px-4 py-2 font-medium text-on-brand disabled:opacity-50">{busy ? "Creating…" : "Create invoice"}</button>
        </form>
        {formError && <p role="status" data-testid="form-error" className="mt-2 text-sm text-danger">{formError}</p>}
      </Card>

      <Card>
        {error && <p role="status" className="text-danger">{error}</p>}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.data.length === 0 && <p className="text-muted">No invoices yet.</p>}
        {data && data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="invoice-table">
              <thead className="text-muted">
                <tr><th className="py-2 pr-3 font-medium">Invoice</th><th className="pr-3 font-medium">Customer</th><th className="pr-3 text-right font-medium">Amount</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Due</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.data.map((i) => {
                  const s = statusOf(i, now);
                  const listing = listings?.listings.find((l) => l.invoiceId === i.id);
                  const badge = listing ? listingBadge(listing.status) : null;
                  const sellable = !listing && i.status === "open" && !!i.dueDate && units(i.amountPaid) === 0n && units(i.amountRefunded) === 0n && Date.parse(i.dueDate) > now + 3_600_000;
                  const refundable = units(i.amountPaid) > units(i.amountRefunded);
                  return (
                    <tr key={i.id} data-testid="invoice-row">
                      <td className="py-2 pr-3">{i.number}</td>
                      <td className="pr-3 text-muted">{i.customerEmail ?? "—"}</td>
                      <td className="amount pr-3 text-right">{money(i.amount)}</td>
                      <td className="pr-3"><Badge tone={s.tone}>{s.label}</Badge>{badge && <> <Badge tone={badge.tone}>{badge.label}</Badge></>}</td>
                      <td className="pr-3 text-muted">{i.dueDate ? i.dueDate.slice(0, 10) : "—"}</td>
                      <td className="flex items-center justify-end gap-2 py-2">
                        <button type="button" onClick={() => copy(i)} className="rounded border border-line px-3 py-1 hover:border-brand">{copied === i.id ? "Copied" : "Copy link"}</button>
                        {sellable && <SellButton invoiceId={i.id} face={i.amount} onDone={reloadListings} />}
                        {refundable && <RefundButton invoiceId={i.id} onDone={() => setTimeout(reload, 1000)} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
