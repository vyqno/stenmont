"use client";

import { useState } from "react";
import { AuthError, api } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { defaultWebhookEvents, WEBHOOK_EVENT_GROUPS, webhookUrlProblem } from "../lib/webhooks";
import { Badge, Card, primaryButton } from "./ui";

type Hooks = { data: { id: string; url: string; events: string[]; active: boolean }[] };

/** Register where events are sent, see the signing secret once, and remove endpoints. */
export function WebhookEndpoints() {
  const hooks = useApi<Hooks>("/v1/webhook-endpoints");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(defaultWebhookEvents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const problem = webhookUrlProblem(url);
    if (problem) return setError(problem);
    if (events.length === 0) return setError("Pick at least one event.");
    setBusy(true);
    setError("");
    try {
      const made = await api.post<{ secret: string; url: string }>("/v1/webhook-endpoints", { url: url.trim(), events });
      setSecret({ url: made.url, value: made.secret });
      setCopied(false);
      setUrl("");
      hooks.reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "The endpoint could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setError("");
    try {
      await api.delete(`/v1/webhook-endpoints/${id}`);
      hooks.reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "The endpoint could not be removed. Try again.");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret!.value);
      setCopied(true);
    } catch {
      setError("Copying was blocked. Select the secret and copy it by hand.");
    }
  }
  const toggle = (id: string) => setEvents((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Card title="Webhooks">
      <div id="webhooks" className="scroll-mt-24" />
      <p className="text-sm text-muted">Stenmont sends a signed message to this address when something happens, such as an invoice being paid. Use the signing secret to check each message really came from us.</p>
      {secret && (
        <div role="status" className="mt-3 rounded border border-foreground p-3 text-sm" data-testid="webhook-secret">
          <p className="font-medium">Copy this signing secret now. It is shown only once.</p>
          <p className="mt-1 text-muted">For {secret.url}. If you lose it, remove the endpoint and add it again.</p>
          <code className="mt-2 block break-all font-mono">{secret.value}</code>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={copy} className={`rounded px-3 py-1 text-sm font-medium ${primaryButton}`}>{copied ? "Copied" : "Copy secret"}</button>
            <button type="button" onClick={() => setSecret(null)} className="rounded border border-line px-3 py-1 text-sm">I have saved it</button>
          </div>
        </div>
      )}
      {hooks.data?.data.length === 0 && <p className="mt-3 text-muted">No webhook endpoints yet.</p>}
      <ul className="mt-3 divide-y divide-line" data-testid="webhooks">
        {hooks.data?.data.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <code className="min-w-0 break-all font-mono text-sm">{h.url}</code>
            <span className="text-sm text-muted">{h.events.length === 0 ? "all events" : `${h.events.length} events`}</span>
            <Badge tone={h.active ? "ok" : "off"}>{h.active ? "Active" : "Paused"}</Badge>
            <button type="button" onClick={() => remove(h.id)} className="rounded border border-line px-3 py-1 text-sm whitespace-nowrap hover:border-danger" aria-label={`Remove ${h.url}`}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="font-bold">Add an endpoint</h3>
        <label className="text-sm">Address (https only)
          <input type="url" inputMode="url" required placeholder="https://shop.example.com/stenmont-webhook" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 block w-full rounded border border-line bg-background px-3 py-2" />
        </label>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Events to send</legend>
          {WEBHOOK_EVENT_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-xs uppercase tracking-wide text-muted">{g.title}</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {g.events.map((ev) => (
                  <label key={ev.id} className="flex min-h-8 items-center gap-2 text-sm">
                    <input type="checkbox" checked={events.includes(ev.id)} onChange={() => toggle(ev.id)} />{ev.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={`self-start rounded px-4 py-2 text-sm font-medium ${primaryButton}`}>{busy ? "Adding…" : "Add endpoint"}</button>
      </form>
    </Card>
  );
}
