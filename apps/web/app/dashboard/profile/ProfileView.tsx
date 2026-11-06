import Link from "next/link";
import { Badge, Card, EmptyState, secondaryLink } from "../../../components/ui";
import { STATE_TEXT, displayValue, explorerTx, type FormValues, type RecordRow, type RowState } from "../../../lib/publicProfile";

const field = "mt-1 block min-h-11 w-full rounded border border-line bg-surface px-3 py-2 text-sm";
const TONE: Record<RowState, "ok" | "wait" | "warn" | "off"> = { new: "wait", changed: "wait", removed: "warn", same: "ok", left_out: "warn", none: "off" };

/** Records published from another page; shown for completeness, never editable here. */
export type ElsewhereRow = { label: string; value: string | null; status: string; href: string; linkText: string };

export type ProfileViewProps = {
  name: string;
  payoutLocked: boolean;
  rows: RecordRow[];
  elsewhere: ElsewhereRow[];
  form: FormValues;
  problems: Partial<Record<keyof FormValues, string>>;
  unsaved: boolean;
  everPublished: boolean;
  publishedAt: string | null;
  changes: number;
  busy: boolean;
  error: string;
  success: { txHash?: string; unchanged: boolean } | null;
  onChange: (k: keyof FormValues, v: string) => void;
  onSubmit: () => void;
};

export function ProfileView(p: ProfileViewProps) {
  const blocked = Object.keys(p.problems).length > 0;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">Your public name: <strong className="break-all">{p.name}</strong></p>

      {p.payoutLocked && (
        <p data-testid="locked-note" className="rounded border border-line bg-surface p-3 text-sm">
          Your payout is locked. A locked name keeps working, but only if this profile was already published before the lock. If it was not, publishing will fail and nothing will change. This cannot be undone.
        </p>
      )}

      <Card title="What you say about your business">
        <form
          onSubmit={(e) => { e.preventDefault(); if (!blocked && !p.busy) p.onSubmit(); }}
          className="flex flex-col gap-4"
          aria-describedby="profile-hint"
        >
          <p id="profile-hint" className="text-sm text-muted">Leave a box empty to take that record down. Web addresses are only published when they are on a website you have confirmed.</p>
          <label className="text-sm font-medium" htmlFor="pay-url">Pay link
            <input id="pay-url" className={field} type="url" inputMode="url" autoComplete="off" maxLength={2048} placeholder="https://pay.example.com/checkout" value={p.form.payUrl} onChange={(e) => p.onChange("payUrl", e.target.value)} aria-invalid={!!p.problems.payUrl} aria-describedby={p.problems.payUrl ? "pay-url-error" : undefined} />
          </label>
          {p.problems.payUrl && <p id="pay-url-error" role="alert" className="-mt-2 text-sm text-danger">{p.problems.payUrl}</p>}
          <label className="text-sm font-medium" htmlFor="x402-url">Agent payment address (optional)
            <input id="x402-url" className={field} type="url" inputMode="url" autoComplete="off" maxLength={2048} placeholder="https://api.example.com/premium" value={p.form.x402Url} onChange={(e) => p.onChange("x402Url", e.target.value)} aria-invalid={!!p.problems.x402Url} aria-describedby={p.problems.x402Url ? "x402-error" : undefined} />
          </label>
          {p.problems.x402Url && <p id="x402-error" role="alert" className="-mt-2 text-sm text-danger">{p.problems.x402Url}</p>}
          <label className="text-sm font-medium" htmlFor="refund">Refund policy (optional)
            <textarea id="refund" className={`${field} min-h-24`} rows={3} maxLength={400} value={p.form.refund} onChange={(e) => p.onChange("refund", e.target.value.replace(/[\r\n]+/g, " "))} aria-invalid={!!p.problems.refund} aria-describedby={p.problems.refund ? "refund-error" : "refund-count"} />
          </label>
          {p.problems.refund
            ? <p id="refund-error" role="alert" className="-mt-2 text-sm text-danger">{p.problems.refund}</p>
            : <p id="refund-count" className="-mt-2 text-xs text-muted">{p.form.refund.trim().length} of 280 characters</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={blocked || p.busy} className="min-h-11 rounded border border-foreground bg-foreground px-5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="publish">
              {p.busy ? "Publishing…" : "Publish profile"}
            </button>
            <span className="text-sm text-muted">Publishing is a network transaction. It can take up to a minute.</span>
          </div>
          <div aria-live="polite">
            {p.busy && <p className="text-sm text-muted">Working… keep this page open.</p>}
            {p.error && <p role="alert" data-testid="publish-error" className="rounded border border-danger p-3 text-sm text-danger">{p.error}</p>}
            {p.success && (
              <p data-testid="publish-success" className="rounded border border-line bg-surface p-3 text-sm">
                {p.success.unchanged ? "Nothing needed to change. Your profile is already up to date." : "Published."}{" "}
                {p.success.txHash && <a className="underline" href={explorerTx(p.success.txHash)} target="_blank" rel="noreferrer">See the transaction</a>}
              </p>
            )}
          </div>
        </form>
      </Card>

      <Card title="What the public sees">
        {p.unsaved && <p data-testid="unsaved-note" className="mb-3 rounded border border-line p-3 text-sm">You have edits that are not published yet. The list below shows your last saved profile; it updates when you publish.</p>}
        {!p.everPublished && <p className="mb-3 text-sm text-muted">Nothing has been published yet. Fill in the boxes above and publish to create your profile; the list will then show each record.</p>}
        <p className="mb-3 text-sm" aria-live="polite">{p.everPublished ? (p.changes === 0 ? "Everything saved is published." : `${p.changes} ${p.changes === 1 ? "record" : "records"} will change when you publish again.`) : ""}{p.publishedAt ? ` Last published ${new Date(p.publishedAt).toLocaleString()}.` : ""}</p>
        <ul className="divide-y divide-line" data-testid="record-list">
          {p.rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 py-3" data-testid={`row-${r.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.label}</span>
                <Badge tone={TONE[r.state]}>{STATE_TEXT[r.state]}</Badge>
                {r.derived && <span className="text-xs text-muted">Set by Stenmont</span>}
              </div>
              <p className="text-sm text-muted">{r.help}</p>
              <p className="break-all text-sm"><span className="text-muted">Published now: </span>{displayValue(r.key, r.published)}</p>
              {(r.state === "new" || r.state === "changed") && <p className="break-all text-sm"><span className="text-muted">After you publish: </span>{displayValue(r.key, r.next)}</p>}
              {r.state === "removed" && <p className="text-sm">After you publish: this record is taken down.</p>}
              {r.note && <p className="text-sm text-danger">{r.note}</p>}
            </li>
          ))}
          {p.elsewhere.map((r) => (
            <li key={r.label} className="flex flex-col gap-1 py-3" data-testid={`row-${r.label}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.label}</span>
                <Badge tone="off">{r.status}</Badge>
                <span className="text-xs text-muted">Published from another page</span>
              </div>
              {r.value && <p className="break-all text-sm">{r.value}</p>}
              <Link href={r.href} className="text-sm underline">{r.linkText}</Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function NoNameState() {
  return (
    <EmptyState
      title="Give your business a name first"
      description="Your public profile lives on your business name. Choose one on the Identity page, then come back to publish how people can pay you."
      action={<Link href="/dashboard/identity" className={secondaryLink}>Go to Identity</Link>}
    />
  );
}
