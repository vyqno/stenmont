"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Stat, money, statusOf, units, type Invoice } from "../../components/ui";
import { useApi } from "../../lib/useApi";
import { fromUnits } from "@stenmont/shared";

export default function Overview() {
  const { data, error } = useApi<{ data: Invoice[] }>("/v1/invoices?limit=100");
  const [now] = useState(() => Date.now());
  if (error) return <p role="status" className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const rows = data.data;
  let received = 0n;
  let waiting = 0n;
  let overdue = 0;
  for (const i of rows) {
    received += units(i.amountPaid) - units(i.amountRefunded);
    if (i.status === "open" || i.status === "partially_paid") {
      waiting += units(i.amount) - units(i.amountPaid);
      if (i.dueDate && Date.parse(i.dueDate) < now) overdue++;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Overview</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Received" value={money(fromUnits(received))} testId="stat-received" />
        <Stat label="Waiting to be paid" value={money(fromUnits(waiting))} />
        <Stat label="Overdue invoices" value={String(overdue)} />
        <Stat label="Invoices" value={String(rows.length)} />
      </div>
      <Card title="Latest invoices">
        {rows.length === 0 ? (
          <p className="text-muted">Nothing yet. <Link href="/dashboard/invoices" className="text-brand underline">Create your first invoice</Link>.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.slice(0, 5).map((i) => {
              const s = statusOf(i, now);
              return (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{i.number}</span>
                  <span className="amount ml-auto">{money(i.amount)}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
