"use client";

import { useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import type { Switch } from "../../../lib/sites";
import { useApi } from "../../../lib/useApi";

/** The business-wide switch. While paused, no new invoices or checkouts are created and customers see "temporarily unavailable". */
export function SwitchCard() {
  const sw = useApi<Switch>("/v1/payment-switch");
  const [error, setError] = useState("");

  async function change(body: Partial<{ paused: boolean; mode: "test" | "live" }>) {
    setError("");
    try {
      await api.post("/v1/payment-switch", body);
      sw.reload();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "That could not be changed. Try again.");
    }
  }

  const s = sw.data;
  return (
    <Card title="3. Take payments on or off">
      <p className="text-sm text-muted">Pause to stop new checkouts at once, for example while you fix something. Customers see that payments are temporarily unavailable, and nothing is charged.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {s && <Badge tone={s.paused ? "warn" : "ok"}>{s.paused ? "Paused" : "Live"}</Badge>}
        {s && (
          <button type="button" onClick={() => change({ paused: !s.paused })} data-testid="switch" className="rounded border border-line px-4 py-2 text-sm hover:border-brand">
            {s.paused ? "Resume payments" : "Pause payments"}
          </button>
        )}
        {s && (
          <label className="flex items-center gap-2 text-sm">
            Label
            <select value={s.mode} onChange={(e) => change({ mode: e.target.value as "test" | "live" })} className="rounded border border-line bg-background px-2 py-1">
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
        )}
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
        {sw.error && <span role="alert" className="text-sm text-danger">{sw.error}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">The label is a note for you and your team. This is the test network; the label does not move real money.</p>
    </Card>
  );
}
