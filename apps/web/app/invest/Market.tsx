"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "../../components/ui";
import { describeReputation, formatYield } from "../../lib/financing";
import { call, type Claim } from "../../lib/investor";
import { formatAmount } from "../../lib/pay";

export default function Market() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ claims: Claim[] }>("GET", "/invest/market").then((r) => setClaims(r.claims), () => setError("The list could not be loaded. Try again in a moment."));
  }, []);

  return (
    <main className="flex flex-col gap-6" data-testid="market">
      <div>
        <h1 className="text-3xl font-bold">Invoices for sale</h1>
        <p className="mt-1 text-muted">Buy a business&apos;s unpaid invoice for less than its face value. When the customer pays, you receive the full amount. Soonest due first.</p>
      </div>
      {error && <p role="status" className="text-danger">{error}</p>}
      {!claims && !error && <p className="text-muted">Loading…</p>}
      {claims && claims.length === 0 && <Card><p className="text-muted" data-testid="market-empty">No invoices are for sale right now. Check back soon.</p></Card>}
      {claims && claims.length > 0 && (
        <div className="flex flex-col gap-3">
          {claims.map((c) => (
            <Link key={c.invoiceId} href={`/invest/${c.invoiceId}`} data-testid="claim-row" className="rounded-lg border border-line bg-surface p-4 hover:border-brand">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.merchant.name}</span>
                <span className="text-sm text-muted">Due {c.dueDate.slice(0, 10)}</span>
              </div>
              <p className="text-xs text-muted">{describeReputation(c.merchant.reputation)}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-muted">You pay</dt><dd className="amount font-medium">{formatAmount(c.price)}</dd></div>
                <div><dt className="text-muted">Customer owes</dt><dd className="amount font-medium">{formatAmount(c.face)}</dd></div>
                <div><dt className="text-muted">Yield if paid on the due date</dt><dd className="amount font-medium">{formatYield(c.yieldToDueDate)}</dd></div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
