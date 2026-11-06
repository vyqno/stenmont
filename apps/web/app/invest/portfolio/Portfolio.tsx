"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { formatYield, listingBadge } from "../../../lib/financing";
import { call, lookupAccount, type Claim } from "../../../lib/investor";
import { loadPasskey } from "../../../lib/passkey";
import { formatAmount } from "../../../lib/pay";

export default function Portfolio() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.resolve(loadPasskey())
      .then((k) => {
        if (!k) { setNoAccount(true); return null; }
        return lookupAccount(k).then((i) => call<{ claims: Claim[] }>("GET", `/invest/portfolio/${i.address}`));
      })
      .then((r) => r && setClaims(r.claims), () => setError("Your portfolio could not be loaded. Try again in a moment."));
  }, []);

  return (
    <main className="flex flex-col gap-6" data-testid="portfolio">
      <h1 className="text-3xl font-bold">Your portfolio</h1>
      {noAccount && <Card><p className="text-muted" data-testid="portfolio-empty">You haven&apos;t bought anything on this device yet. <Link href="/invest" className="underline">See what is for sale</Link>.</p></Card>}
      {error && <p role="status" className="text-danger">{error}</p>}
      {claims && claims.length === 0 && <Card><p className="text-muted" data-testid="portfolio-empty">Nothing here yet. <Link href="/invest" className="underline">See what is for sale</Link>.</p></Card>}
      {claims && claims.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="p-3 font-medium">Business</th><th className="font-medium">You paid</th><th className="font-medium">Owed at the due date</th><th className="font-medium">Yield if paid on time</th><th className="font-medium">Due</th><th className="font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {claims.map((c) => {
                const b = listingBadge(c.status);
                return (
                  <tr key={c.invoiceId} data-testid="portfolio-row">
                    <td className="p-3">{c.merchant.name}</td>
                    <td className="amount">{formatAmount(c.price)}</td>
                    <td className="amount">{formatAmount(c.face)}</td>
                    <td className="amount">{formatYield(c.yieldToDueDate)}</td>
                    <td>{c.dueDate.slice(0, 10)}</td>
                    <td>{b ? <Badge tone={b.tone}>{b.label}</Badge> : c.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
