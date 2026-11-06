import Link from "next/link";
import { Badge, Card, EmptyState, Stat, actionLink, money, statusOf, type Invoice } from "../../components/ui";
import type { BooksStatus, SiteStatus, Step } from "../../lib/overview";
import type { Part } from "../../lib/useApi";

export type OverviewProps = {
  now: number;
  steps: Part<Step[]>;
  received: Part<string | null>;
  invoices: Part<{ rows: Invoice[]; count: number; outstanding: string; overdue: number }>;
  due: Part<{ subscriptions: number; instalments: number; total: number }>;
  site: Part<SiteStatus>;
  books: Part<BooksStatus | null>;
  agent: Part<{ daily: number; monthly: number; limits: { daily: number; monthly: number } } | null>;
};

const SHOWN = (p: Part<unknown>, fn: () => string) => (p.status === "ready" ? fn() : p.status === "loading" ? "…" : "Unavailable");

export function OverviewView(p: OverviewProps) {
  return (
    <div className="flex flex-col gap-6">
      <NextSteps steps={p.steps} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key figures">
        <Stat label="Received this month" value={SHOWN(p.received, () => (p.received.status === "ready" && p.received.value !== null ? money(p.received.value) : "Unavailable"))} testId="stat-received" />
        <Stat label="Waiting to be paid" value={SHOWN(p.invoices, () => (p.invoices.status === "ready" ? money(p.invoices.value.outstanding) : ""))} />
        <Stat label={p.invoices.status === "ready" && p.invoices.value.overdue ? `Open invoices, ${p.invoices.value.overdue} overdue` : "Open invoices"} value={SHOWN(p.invoices, () => (p.invoices.status === "ready" ? String(p.invoices.value.count) : ""))} />
        <Stat label="Due in the next 7 days" value={SHOWN(p.due, () => (p.due.status === "ready" ? String(p.due.value.total) : ""))} />
      </div>
      {p.due.status === "ready" && p.due.value.total > 0 && (
        <p className="-mt-3 text-sm text-muted" data-testid="due-detail">
          {p.due.value.subscriptions} {p.due.value.subscriptions === 1 ? "subscription" : "subscriptions"} and {p.due.value.instalments} {p.due.value.instalments === 1 ? "instalment" : "instalments"} will be charged. <Link href="/dashboard/subscriptions" className="underline">See them</Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Your site"><SiteCard site={p.site} /></Card>
        <Card title="Books"><BooksCard books={p.books} /></Card>
        <Card title="Finance assistant"><AgentCard agent={p.agent} /></Card>
      </div>

      <Card title="Latest invoices">
        {p.invoices.status === "loading" && <p role="status" aria-busy="true" className="text-muted">Loading your invoices…</p>}
        {p.invoices.status === "error" && <p role="alert" className="text-danger">Your invoices could not be loaded. {p.invoices.message}</p>}
        {p.invoices.status === "ready" && p.invoices.value.rows.length === 0 && (
          <EmptyState title="No invoices yet" description="Create an invoice, or connect your site so checkout creates them for you." action={<Link href="/dashboard/invoices" className={actionLink}>Create your first invoice</Link>} />
        )}
        {p.invoices.status === "ready" && p.invoices.value.rows.length > 0 && (
          <ul className="divide-y divide-line">
            {p.invoices.value.rows.slice(0, 5).map((i) => {
              const s = statusOf(i, p.now);
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 truncate">{i.number}</span>
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

function NextSteps({ steps }: { steps: Part<Step[]> }) {
  if (steps.status !== "ready") return steps.status === "loading" ? <p role="status" aria-busy="true" className="text-muted">Loading your checklist…</p> : null;
  const left = steps.value.filter((s) => s.done !== true).length;
  if (left === 0) return <p className="rounded-2xl border border-line bg-surface p-4 text-sm" data-testid="all-set">Your business is set up: verified, connected, with products and a public profile.</p>;
  return (
    <Card title="Get set up" className="p-4 sm:p-6">
      <p className="mb-3 text-sm text-muted" data-testid="steps-left">{left} of {steps.value.length} steps left.</p>
      <ol className="grid gap-2 md:grid-cols-2" data-testid="next-steps">
        {steps.value.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2">
              <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-foreground bg-foreground text-background" : "border-line"}`}>{s.done ? "✓" : ""}</span>
              <span className="min-w-0">
                <span className="block font-medium">{s.title} <span className="text-sm font-normal text-muted">{s.done === true ? "(done)" : s.done === null ? "(status unknown)" : ""}</span></span>
                <span className="block text-sm text-muted">{s.help}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function SiteCard({ site }: { site: Part<SiteStatus> }) {
  if (site.status === "loading") return <p role="status" aria-busy="true" className="text-muted">Loading…</p>;
  if (site.status === "error") return <p role="alert" className="text-danger">Your site status could not be loaded.</p>;
  const s = site.value;
  if (s.state === "none") return <EmptyState title="No site connected" description="Connect your site so customers can pay you at checkout." action={<Link href="/dashboard/connect" className={actionLink}>Connect your site</Link>} />;
  return (
    <div className="flex flex-col gap-2">
      <p><Badge tone={s.state === "paused" ? "warn" : "ok"}>{s.state === "paused" ? "Paused" : "Live"}</Badge></p>
      <p className="text-sm" data-testid="site-checks">{s.checks}{s.ready ? " (ready)" : ""}</p>
      {s.state === "paused" && <p className="text-sm text-muted">Customers see that payments are temporarily unavailable.</p>}
      <Link href="/dashboard/connect" className="text-sm underline">Open Connect</Link>
    </div>
  );
}

function BooksCard({ books }: { books: Part<BooksStatus | null> }) {
  if (books.status === "loading") return <p role="status" aria-busy="true" className="text-muted">Loading…</p>;
  if (books.status === "error" || !books.value) return <p className="text-sm text-muted">Books could not be read right now. <Link href="/dashboard/books" className="underline">Open Books</Link></p>;
  const b = books.value;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{b.month}: <Badge tone={b.closed ? "ok" : "wait"}>{b.closed ? "Closed" : "Open"}</Badge></p>
      {b.previous && <p data-testid="previous-month">{b.previous.month}: <Badge tone={b.previous.closed ? "ok" : "warn"}>{b.previous.closed ? "Closed" : "Not closed yet"}</Badge></p>}
      <Link href="/dashboard/books" className="underline">Open Books</Link>
    </div>
  );
}

function AgentCard({ agent }: { agent: Part<{ daily: number; monthly: number; limits: { daily: number; monthly: number } } | null> }) {
  if (agent.status === "loading") return <p role="status" aria-busy="true" className="text-muted">Loading…</p>;
  if (agent.status === "error" || !agent.value) return <p className="text-sm text-muted">Usage is not available. <Link href="/dashboard/agent" className="underline">Open the assistant</Link></p>;
  const { daily, limits } = agent.value;
  const pct = limits.daily > 0 ? Math.min(100, Math.round((daily / limits.daily) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{daily.toLocaleString("en-US")} of {limits.daily.toLocaleString("en-US")} used today</p>
      <div role="meter" aria-label="Assistant usage today" aria-valuemin={0} aria-valuemax={limits.daily} aria-valuenow={Math.min(daily, limits.daily)} className="h-2 w-full rounded-full bg-line">
        <div className="h-2 rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted">{agent.value.monthly.toLocaleString("en-US")} of {limits.monthly.toLocaleString("en-US")} used this month.</p>
      <Link href="/dashboard/agent" className="underline">Open the assistant</Link>
    </div>
  );
}
