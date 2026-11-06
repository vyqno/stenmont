"use client";

import { useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { WorldVerify } from "../../../components/WorldVerify";
import { AuthError, api } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";
import { useMerchant } from "../DashboardShell";

type Keys = { data: { id: string; display: string; createdAt: string; revoked: boolean }[] };
type Hooks = { data: { id: string; url: string; events: string[]; active: boolean }[] };
type Tank = { balance: string; dailyCap: string; spentToday: string; perPayerDailyCapUsdt: string };

export default function Settings() {
  const merchant = useMerchant();
  const keys = useApi<Keys>("/v1/api-keys");
  const hooks = useApi<Hooks>("/v1/webhook-endpoints");
  const tank = useApi<Tank>("/v1/gas-tank");
  const [fresh, setFresh] = useState<string | null>(null);
  const [keyError, setKeyError] = useState("");

  async function makeKey() {
    setKeyError("");
    try {
      setFresh((await api.post<{ key: string }>("/v1/api-keys")).key);
      keys.reload();
    } catch (e) {
      setKeyError(e instanceof AuthError ? e.message : "The key could not be made. Try again.");
    }
  }
  async function revoke(id: string) {
    setKeyError("");
    try {
      await api.post(`/v1/api-keys/${id}/revoke`);
      keys.reload();
    } catch (e) {
      setKeyError(e instanceof AuthError ? e.message : "The key could not be revoked. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Card title="Your business">
        <p>{merchant.name}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted" data-testid="account">Account {merchant.account}</p>
      </Card>

      <WorldVerify />

      <Card title="API keys">
        {keys.data?.data.length === 0 && <p className="text-muted">No keys.</p>}
        <ul className="divide-y divide-line" data-testid="api-keys">
          {keys.data?.data.map((k) => (
            <li key={k.id} className="flex items-center justify-between py-2">
              <code className="font-mono text-sm">{k.display}</code>
              <span className="text-sm text-muted">created {k.createdAt.slice(0, 10)}</span>
              {k.revoked ? <Badge tone="off">Revoked</Badge> : <button type="button" onClick={() => revoke(k.id)} className="rounded border border-line px-3 py-1 text-sm hover:border-danger">Revoke</button>}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={makeKey} className="rounded border border-line px-3 py-1 text-sm hover:border-brand">Make a new key</button>
          {keyError && <span role="status" className="text-sm text-danger">{keyError}</span>}
        </div>
        {fresh && (
          <p className="mt-3 text-sm">
            Copy this key now. It is shown only once: <code data-testid="new-key" className="break-all font-mono">{fresh}</code>
          </p>
        )}
        <p className="mt-2 text-sm text-muted">A key is shown in full only once, when it is made. You cannot revoke your only working key.</p>
      </Card>

      <Card title="Webhooks">
        {hooks.data?.data.length === 0 && <p className="text-muted">No webhook endpoints yet.</p>}
        <ul className="divide-y divide-line" data-testid="webhooks">
          {hooks.data?.data.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <code className="break-all font-mono text-sm">{h.url}</code>
              <span className="text-sm text-muted">{h.events.length === 0 ? "all events" : h.events.join(", ")}</span>
              <Badge tone={h.active ? "ok" : "off"}>{h.active ? "Active" : "Paused"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Payment fees paid by you">
        <p className="text-sm text-muted">Your customers never pay a network fee. You set aside a little to cover it, and each payment uses a small part.</p>
        {tank.data && (
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="gas-tank">
            <div><dt className="text-sm text-muted">Set aside</dt><dd className="amount text-lg font-bold">{Number(tank.data.balance).toFixed(4)} WBT</dd></div>
            <div><dt className="text-sm text-muted">Used today</dt><dd className="amount text-lg font-bold">{Number(tank.data.spentToday).toFixed(4)} WBT</dd></div>
            <div><dt className="text-sm text-muted">Daily limit</dt><dd className="amount text-lg font-bold">{Number(tank.data.dailyCap).toFixed(4)} WBT</dd></div>
            <div><dt className="text-sm text-muted">Per customer, per day</dt><dd className="amount text-lg font-bold">${Number(tank.data.perPayerDailyCapUsdt).toFixed(2)}</dd></div>
          </dl>
        )}
      </Card>
    </div>
  );
}
