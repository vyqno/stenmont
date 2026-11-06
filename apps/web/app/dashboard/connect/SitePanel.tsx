"use client";

import { useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { checkRows, progress, type Site } from "../../../lib/sites";

const STATE = {
  pass: { tone: "ok", text: "Passed" },
  fail: { tone: "bad", text: "Not passed" },
  todo: { tone: "off", text: "Not checked" },
} as const;

function SiteCard({ site, reload }: { site: Site; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      await api.post(`/v1/sites/${site.id}/check`);
      reload();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "The checks could not run. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setError("");
    try {
      await api.delete(`/v1/sites/${site.id}`);
      reload();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "The site could not be removed. Try again.");
    }
  }

  return (
    <li className="rounded border border-line p-4" data-testid="site">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all font-mono text-sm">{site.url}</span>
        {site.ready ? <Badge tone="ok">Ready</Badge> : <Badge tone="wait">{progress(site)} checks passed</Badge>}
      </div>
      <ul className="mt-3 divide-y divide-line" aria-label={`Checks for ${site.host}`}>
        {checkRows(site).map((r) => (
          <li key={r.kind} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid={`check-${r.kind}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-sm text-muted">{r.detail}</p>
            </div>
            <div className="text-right">
              <Badge tone={STATE[r.state].tone}>{STATE[r.state].text}</Badge>
              {r.checkedAt && <p className="mt-1 text-xs text-muted"><time dateTime={r.checkedAt}>{new Date(r.checkedAt).toLocaleString()}</time></p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded bg-background p-3 text-sm">
        <p className="font-medium">To verify the domain, add this DNS TXT record</p>
        <p className="mt-1 break-all font-mono text-xs">Name: {site.verification.recordName}</p>
        <p className="break-all font-mono text-xs">Value: {site.verification.recordValue}</p>
        <p className="mt-1 text-muted">It lives on a separate name, so it never clashes with the records your site already has. DNS can take a few minutes to update.</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={busy} className="rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Checking…" : "Check again"}
        </button>
        <button type="button" onClick={remove} className="rounded border border-line px-3 py-2 text-sm hover:border-danger">Remove</button>
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      </div>
    </li>
  );
}

export function SitePanel({ sites, reload, loadError }: { sites: Site[] | null; reload: () => void; loadError: string | null }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAdding(true);
    try {
      await api.post("/v1/sites", { url: url.trim() });
      setUrl("");
      reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "The site could not be added. Try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card title="1. Is your site accepting payments?">
      <p className="text-sm text-muted">Add your site&apos;s address. Four checks show whether payments will work: the site is up, the domain is yours, your webhook answers, and a test payment went through.</p>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="site-url" className="sr-only">Site address</label>
        <input id="site-url" type="url" required inputMode="url" placeholder="https://shop.example.com" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 flex-1 rounded border border-line bg-background px-3 py-2 text-sm" />
        <button type="submit" disabled={adding} className="rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{adding ? "Adding…" : "Add site"}</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {loadError && <p role="alert" className="mt-2 text-sm text-danger">{loadError}</p>}
      {sites?.length === 0 && <p className="mt-4 text-sm text-muted">No site yet. Use the full address, starting with https://</p>}
      <ul className="mt-4 flex flex-col gap-4" data-testid="sites">
        {sites?.map((s) => <SiteCard key={s.id} site={s} reload={reload} />)}
      </ul>
    </Card>
  );
}
