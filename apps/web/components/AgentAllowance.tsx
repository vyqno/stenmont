"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthError, api } from "../lib/auth";
import { allowanceCard, pauseOutcome, planPauseAll, type AllowanceState } from "../lib/agentCards";
import type { Agent } from "../lib/identity";
import { Badge } from "./ui";

const TONE: Record<AllowanceState, "ok" | "wait" | "warn" | "bad" | "off"> = { ok: "ok", near: "warn", over: "bad", unknown: "off", expired: "off" };
const button = "rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50";
const REFRESH_MS = 30_000;

/**
 * Live spend against the daily limit for each agent, and one control that pauses them all. Pausing uses the existing
 * revocation (one request per agent): the agent's right to edit its record is removed and its name is released, so to
 * resume the business creates the agent again. The spend is read from the token's own transfers, about the last 24 hours.
 */
export function AgentAllowance({ agents, onChanged }: { agents: Agent[]; onChanged: () => Promise<void> }) {
  const [spend, setSpend] = useState<Record<string, string | null>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState("");
  const live = agents.filter((a) => a.status !== "revoked");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ data: { label: string; spent: string | null }[] }>("/v1/ens/agents/spend");
      setSpend(Object.fromEntries(r.data.map((d) => [d.label, d.spent])));
    } catch {
      setSpend({}); // every card then says the spend could not be read
    }
  }, []);

  useEffect(() => {
    if (live.length === 0) return;
    void Promise.resolve().then(load);
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, live.length]);

  if (live.length === 0) return null;

  async function pauseAll() {
    const labels = planPauseAll(agents);
    setBusy(true);
    setResult("");
    const results: { label: string; ok: boolean }[] = [];
    for (const [i, label] of labels.entries()) {
      setProgress(`Pausing ${label} (${i + 1} of ${labels.length})… This can take a minute each.`);
      try {
        await api.delete(`/v1/ens/agents/${encodeURIComponent(label)}`);
        results.push({ label, ok: true });
      } catch (e) {
        // Already revoked elsewhere counts as paused.
        results.push({ label, ok: e instanceof AuthError && e.code === "already_revoked" });
      }
    }
    setProgress("");
    setResult(pauseOutcome(results).message);
    setConfirmed(false);
    setBusy(false);
    await onChanged();
  }

  return (
    <section aria-label="Agent allowances" className="mt-4" data-testid="agent-allowances">
      <ul className="grid gap-3 sm:grid-cols-2">
        {live.map((a) => {
          const c = allowanceCard(a, a.label in spend ? (spend[a.label] ?? null) : null);
          return (
            <li key={a.label} data-testid="allowance-card" className="rounded border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-all text-sm font-medium">{a.name}</p>
                <Badge tone={TONE[c.state]}>{c.state === "over" ? "over limit" : c.state === "near" ? "near limit" : c.state === "unknown" ? "unknown" : c.state}</Badge>
              </div>
              <div className="mt-2 h-2 w-full rounded bg-line" role="progressbar" aria-label={`${a.label} spend against its daily limit`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.percent ?? 0}>
                <div className={`h-2 rounded ${c.state === "over" ? "bg-danger" : "bg-brand"}`} style={{ width: `${c.percent ?? 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">{c.summary}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 rounded border border-line p-3">
        <p className="text-sm font-medium">Pause all agents</p>
        <p className="mt-1 text-xs text-muted">Removes every agent&apos;s permission and releases its name, using the same step as Revoke. Agents stop being able to use their names at once; to resume you create them again.</p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
          I understand this removes {live.length === 1 ? "this agent" : `all ${live.length} agents`} until they are created again.
        </label>
        <button className={`${button} mt-3`} disabled={!confirmed || busy} onClick={() => void pauseAll()}>Pause all agents</button>
        {progress && <p aria-live="polite" className="mt-2 text-sm text-muted">{progress}</p>}
        {result && <p role="status" className="mt-2 text-sm">{result}</p>}
      </div>
    </section>
  );
}
