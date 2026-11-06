"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, money } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { listingBadge } from "../../../lib/financing";
import { STEP_EXPLANATIONS, buildSteps, certificateUrl, formatWhen, type Step, type StepKey, type StepState, type TimelineItem } from "../../../lib/financingTimeline";
import { useApi } from "../../../lib/useApi";

const TITLES: Record<StepKey, string> = { listed: "Listed", investor: "Investor verified", funded: "Funded", payment: "Customer pays", close: "Settled or defaulted" };
const DOT: Record<StepState, string> = {
  done: "bg-mint text-navy",
  current: "border-2 border-brand bg-surface text-foreground",
  waiting: "border border-line bg-surface text-muted",
  failed: "bg-danger text-white",
  skipped: "border border-line bg-line text-navy",
};
const MARK: Record<StepState, string> = { done: "✓", current: "•", waiting: "", failed: "!", skipped: "–" };
const STATE_WORD: Record<StepState, string> = { done: "Done", current: "Now", waiting: "Waiting", failed: "Problem", skipped: "Skipped" };

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex gap-3" data-testid={`step-${step.key}`} data-state={step.state}>
      <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${DOT[step.state]}`}>{MARK[step.state]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {step.title} <span className="ml-1 text-xs font-normal text-muted">{STATE_WORD[step.state]}</span>
        </p>
        {step.at && <p className="text-xs text-muted">{formatWhen(step.at)}</p>}
        {step.facts.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            {step.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd className="amount">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {step.url && (
          <a href={step.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm underline" data-testid={`tx-${step.key}`}>View transaction</a>
        )}
      </div>
    </li>
  );
}

function Item({ item, onChanged }: { item: TimelineItem; onChanged: () => void }) {
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const steps = buildSteps(item, now);
  const badge = listingBadge(item.status) ?? { label: item.status === "cancelled" ? "Not sold" : "Funding", tone: "off" as const };
  const link = typeof window === "undefined" ? "" : certificateUrl(window.location.origin, item.invoiceId);

  async function toggleNumber(show: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/v1/financing/listings/${item.claimId}/public-number`, { showInvoiceNumber: show });
      onChanged();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold" data-testid="financing-invoice">Invoice {item.invoiceNumber}</h2>
          <p className="text-sm text-muted">
            <span className="amount">{money(item.face)}</span> invoice, <span className="amount">{money(item.advance)}</span> cash today, due {item.dueDate.slice(0, 10)}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <ol className="flex flex-col gap-4" aria-label={`Steps for invoice ${item.invoiceNumber}`}>
        {steps.map((s) => <StepRow key={s.key} step={s} />)}
      </ol>
      <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/claim/${item.invoiceId}`} className="underline" data-testid="certificate-link">Public certificate</Link>
          <button type="button" className="rounded border border-line px-3 py-1 hover:border-brand" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={item.showInvoiceNumber} disabled={busy} onChange={(e) => toggleNumber(e.target.checked)} data-testid="show-number" />
          Show the invoice number on the public certificate (hidden unless you tick this)
        </label>
        {error && <p role="status" className="text-danger">{error}</p>}
      </div>
    </Card>
  );
}

export default function Financing() {
  const { data, error, reload } = useApi<{ items: TimelineItem[] }>("/v1/financing/timeline");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Financing</h1>
        <p className="mt-1 text-muted">Follow each invoice you sold to an investor, from the offer to the money coming in.</p>
      </div>

      <Card title="What each step means for you">
        <dl className="grid gap-3 text-sm md:grid-cols-2" data-testid="explanations">
          {(Object.keys(TITLES) as StepKey[]).map((k) => (
            <div key={k}>
              <dt className="font-medium">{TITLES[k]}</dt>
              <dd className="text-muted">{STEP_EXPLANATIONS[k]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {error && <p role="status" className="text-danger">{error}</p>}
      {!data && !error && <p className="text-muted">Loading…</p>}
      {data && data.items.length === 0 && (
        <Card>
          <p className="text-muted" data-testid="financing-empty">
            Nothing sold yet. Open <Link href="/dashboard/invoices" className="underline">Invoices</Link> and choose &ldquo;Sell this invoice&rdquo; on an unpaid one to get paid early.
          </p>
        </Card>
      )}
      {data?.items.map((i) => <Item key={i.claimId} item={i} onChanged={reload} />)}
    </div>
  );
}
