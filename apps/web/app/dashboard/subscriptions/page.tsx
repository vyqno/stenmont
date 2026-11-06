"use client";

import { useState } from "react";
import { Badge, Card, money } from "../../../components/ui";
import { api } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";

type Sub = { id: string; status: string; amount: string; periodSeconds: number; maxCharges: number; charges: number; payer: string | null; nextChargeAt: string | null; subscribeUrl: string };

const every = (s: number) => (s % 86_400 === 0 ? `${s / 86_400} day${s === 86_400 ? "" : "s"}` : s % 3_600 === 0 ? `${s / 3_600} hours` : `${Math.round(s / 60)} minutes`);
const TONE: Record<string, "ok" | "wait" | "warn" | "off"> = { active: "ok", offered: "wait", past_due: "warn", cancelled: "off", completed: "off" };

export default function Subscriptions() {
  const { data, error, reload } = useApi<{ data: Sub[] }>("/v1/subscriptions");
  const [busy, setBusy] = useState("");

  async function cancel(id: string) {
    setBusy(id);
    await api.post(`/v1/subscriptions/${id}/cancel`).catch(() => null);
    setBusy("");
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <Card>
        {error && <p role="status" className="text-danger">{error}</p>}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.data.length === 0 && <p className="text-muted">No subscriptions yet.</p>}
        {data && data.data.length > 0 && (
          <ul className="divide-y divide-line" data-testid="subscription-list">
            {data.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="amount font-medium">{money(s.amount)}</span>
                <span className="text-muted">every {every(s.periodSeconds)} · {s.charges} of {s.maxCharges} charged</span>
                <Badge tone={TONE[s.status] ?? "wait"}>{s.status.replace("_", " ")}</Badge>
                {s.nextChargeAt && <span className="text-sm text-muted">next {s.nextChargeAt.slice(0, 10)}</span>}
                <span className="ml-auto" />
                {(s.status === "active" || s.status === "offered" || s.status === "past_due") && (
                  <button type="button" onClick={() => cancel(s.id)} disabled={busy === s.id} className="rounded border border-line px-3 py-1 text-sm hover:border-danger disabled:opacity-50">Stop charging</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
