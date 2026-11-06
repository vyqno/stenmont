"use client";

import { b64urlDecode, b64urlEncode, encodeWebAuthnSignature, parseDerSignature } from "@stenmont/shared";
import { hexToBytes, type Hex } from "viem";
import { useState } from "react";
import { AuthError, api, signChallenge } from "../../../lib/auth";
import { isTestEnvironment } from "../../../lib/pay";
import { useApi } from "../../../lib/useApi";
import { Badge, Card, money, primaryButton } from "../../../components/ui";

type Sub = {
  id: string; status: string; amount: string; periodSeconds: number; maxCharges: number; charges: number; payer: string | null; nextChargeAt: string | null; subscribeUrl: string;
  kind?: string; invoiceId?: string; payerBusinessName?: string; total?: string; atRisk?: { reason: string; since: string | null } | null;
};
const AT_RISK: Record<string, string> = { balance: "Customer balance is low", allowance: "Customer approval is too small" };

const every = (s: number) => (s % 86_400 === 0 ? `${s / 86_400} day${s === 86_400 ? "" : "s"}` : s % 3_600 === 0 ? `${s / 3_600} hours` : `${Math.round(s / 60)} minutes`);
const TONE: Record<string, "ok" | "wait" | "warn" | "off"> = { active: "ok", offered: "wait", past_due: "warn", cancelled: "off", completed: "off" };

export default function Subscriptions() {
  const { data, error, reload } = useApi<{ data: Sub[] }>("/v1/subscriptions");
  const [busy, setBusy] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("2592000");
  const [max, setMax] = useState("12");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError("");
    try {
      await api.post("/v1/subscriptions", { amount, periodSeconds: Number(period), maxCharges: Number(max) });
      setAmount("");
      reload();
    } catch (err) {
      setFormError(err instanceof AuthError ? err.message : "The subscription could not be created. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function prepare(id: string) {
    setBusy(id); setFormError("");
    try {
      const terms = await api.get<{ deadline: string; digest: Hex }>(`/v1/subscriptions/${id}/prepare-terms`);
      const assertion = await signChallenge(b64urlEncode(hexToBytes(terms.digest)));
      const der = parseDerSignature(b64urlDecode(assertion.signature));
      const signature = encodeWebAuthnSignature({ r: der.r, s: der.s, authenticatorData: b64urlDecode(assertion.authenticatorData), clientDataJSON: new TextDecoder().decode(b64urlDecode(assertion.clientDataJSON)) });
      await api.post(`/v1/subscriptions/${id}/prepare`, { deadline: terms.deadline, signature });
      reload();
    } catch (e) { setFormError(e instanceof AuthError ? e.message : "Preparation failed. Try again."); }
    finally { setBusy(""); }
  }

  async function cancel(id: string) {
    setBusy(id);
    try {
      const sub = data?.data.find(s => s.id === id);
      let body = {};
      if (sub?.kind === "instalment" && sub.payer) {
        const terms = await api.get<{ deadline: string; agreements: { id: string; digest: Hex }[] }>(`/v1/subscriptions/${id}/cancel-terms`);
        const signatures = [];
        for (const agreement of terms.agreements) {
          const assertion = await signChallenge(b64urlEncode(hexToBytes(agreement.digest)));
          const der = parseDerSignature(b64urlDecode(assertion.signature));
          signatures.push({ id: agreement.id, signature: encodeWebAuthnSignature({ r: der.r, s: der.s, authenticatorData: b64urlDecode(assertion.authenticatorData), clientDataJSON: new TextDecoder().decode(b64urlDecode(assertion.clientDataJSON)) }) });
        }
        body = { deadline: terms.deadline, signatures };
      }
      await api.post(`/v1/subscriptions/${id}/cancel`, body);
    } catch (e) { setFormError(e instanceof AuthError ? e.message : "Cancellation failed. Try again."); }
    setBusy("");
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <Card title="New subscription">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1 text-sm">
            Amount each time (USD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" placeholder="9.99" className="amount rounded border border-line bg-transparent px-3 py-2 text-base" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            How often
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded border border-line bg-surface px-3 py-2 text-base">
              {typeof location !== "undefined" && isTestEnvironment(location.hostname) && <option value="60">Every minute (for testing)</option>}
              <option value="604800">Every week</option>
              <option value="2592000">Every 30 days</option>
              <option value="31536000">Every year</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Most payments
            <input value={max} onChange={(e) => setMax(e.target.value)} required type="number" min={1} max={10000} className="amount rounded border border-line bg-transparent px-3 py-2 text-base" />
          </label>
          <button disabled={creating} className={`rounded px-4 py-2 font-medium ${primaryButton}`}>{creating ? "Creating…" : "Create subscription"}</button>
        </form>
        {formError && <p role="status" className="mt-2 text-sm text-danger">{formError}</p>}
        <p className="mt-2 text-sm text-muted">Send the link to your customer. They approve once, and you can stop charging any time.</p>
      </Card>
      <Card>
        {error && <p role="status" className="text-danger">{error}</p>}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.data.length === 0 && <p className="text-muted">No subscriptions yet.</p>}
        {data && data.data.length > 0 && (
          <ul className="divide-y divide-line" data-testid="subscription-list">
            {data.data.map((s) => (
              <li key={s.id} data-testid="subscription-row" className="flex flex-wrap items-center gap-3 py-3">
                <span className="amount font-medium">{money(s.amount)}</span>
                {s.kind === "instalment" ? (
                  <span className="text-muted" data-testid="instalment-summary">
                    Pay in {s.maxCharges} · {s.payerBusinessName} · {money(s.total ?? s.amount)} total · every {every(s.periodSeconds)} · {s.charges} of {s.maxCharges} paid
                  </span>
                ) : (
                  <span className="text-muted">every {every(s.periodSeconds)} · {s.charges} of {s.maxCharges} charged</span>
                )}
                {s.atRisk && <Badge tone="warn">At risk: {AT_RISK[s.atRisk.reason] ?? "next payment may fail"}</Badge>}
                <Badge tone={TONE[s.status] ?? "wait"}>{s.status.replace("_", " ")}</Badge>
                {s.nextChargeAt && <span className="text-sm text-muted">next {s.nextChargeAt.slice(0, 10)}</span>}
                <span className="ml-auto" />
                {s.kind === "instalment" && s.status === "offered" && <div className="text-sm"><p>Preparing cancels the original invoice payment link, then fixes the final balance for this replacement plan.</p><button type="button" disabled={busy === s.id} onClick={() => prepare(s.id)} className="rounded border border-line px-3 py-1">Prepare replacement plan</button></div>}
                {s.status === "offered" && (
                  <button type="button" onClick={() => navigator.clipboard.writeText(s.subscribeUrl).then(() => setCopied(s.id))} className="rounded border border-line px-3 py-1 text-sm hover:border-brand">
                    {copied === s.id ? "Copied" : "Copy link"}
                  </button>
                )}
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
