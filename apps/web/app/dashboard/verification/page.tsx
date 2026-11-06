"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";
import { formatUsd, ladder, routeCards, type RouteCard, type VerificationStatus } from "../../../lib/verification";
import { WalletConnect } from "./WalletConnect";

const link = "rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand";
const LINKS: Partial<Record<RouteCard["route"], { href: string; label: string }>> = {
  domain: { href: "/dashboard/connect", label: "Go to Connect" },
  world: { href: "/dashboard/settings", label: "Verify in Settings" },
};
const TONE = { reached: "ok", current: "ok", next: "wait", later: "off" } as const;
const WORD = { reached: "Done", current: "You are here", next: "Next", later: "Later" } as const;

export default function Verification() {
  const { data, error, reload } = useApi<VerificationStatus>("/v1/verification");
  const [message, setMessage] = useState("");
  const [check, setCheck] = useState<{ url: string; sandbox: boolean } | null>(null);

  async function run(label: string, f: () => Promise<unknown>) {
    setMessage("");
    try {
      await f();
      reload();
    } catch (e) {
      setMessage(e instanceof AuthError ? e.message : `${label} could not be done right now. Try again.`);
    }
  }
  const startCheck = () => run("The check", async () => setCheck(await api.post<{ url: string; sandbox: boolean }>("/v1/verification/kyc/start")));
  const finishSandbox = (result: "green" | "red") => run("The test decision", async () => { await api.post("/v1/verification/kyc/sandbox-decision", { result }); setCheck(null); });
  const publish = () => run("Publishing", () => api.post("/v1/verification/badge/publish"));

  if (error) return <p role="status" className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const rows = ladder(data);
  const cards = routeCards(data);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Verification</h1>
        <p className="mt-1 text-muted">The more your business is verified, the more you can invoice and the more you can do. Pick the route that suits you.</p>
      </div>

      <Card title="Your level">
        <p className="text-2xl font-bold" data-testid="current-tier">{rows.find((r) => r.state === "current")?.name}</p>
        <p className="mt-1 text-sm text-muted">Invoiced in the last 24 hours: {formatUsd(data.usedToday)}</p>
        {data.nextStep && <p className="mt-3 text-sm" data-testid="next-step"><span className="font-medium">Next step:</span> {data.nextStep.howTo}</p>}
        <p className="mt-3 text-xs text-muted">These limits are demo settings for testing, not final.</p>
      </Card>

      <Card title="What each level unlocks">
        <ol className="divide-y divide-line" data-testid="ladder">
          {rows.map((r) => (
            <li key={r.tier} className="py-3" data-state={r.state}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge tone={TONE[r.state]}>{WORD[r.state]}</Badge>
              </div>
              <p className="text-sm text-muted">{r.how}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">{r.unlocks.map((u) => <li key={u}>{u}</li>)}</ul>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Ways to move up">
        <ul className="flex flex-col gap-4" data-testid="routes">
          {cards.map((c) => (
            <li key={c.route} data-route={c.route} data-state={c.state}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.title}</span>
                {c.state === "done" && <Badge tone="ok">Done</Badge>}
                {c.state === "pending" && <Badge tone="wait">In progress</Badge>}
              </div>
              <p className="text-sm text-muted">{c.plain}</p>
              {c.state === "open" && c.route === "email" && <p className="mt-2 text-sm text-muted">Email codes are not switched on yet.</p>}
              {c.state === "open" && LINKS[c.route] && <Link href={LINKS[c.route]!.href} className={`mt-2 inline-block ${link}`}>{LINKS[c.route]!.label}</Link>}
              {(c.state === "open" || c.state === "pending") && c.route === "documents" && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={startCheck} className={link} data-testid="kyc-start">Start the check</button>
                  {check && <a href={check.url} className="text-sm underline">Continue with our partner</a>}
                  {(check?.sandbox || data.kyc.sandbox) && (
                    <>
                      <button type="button" onClick={() => finishSandbox("green")} className={link} data-testid="kyc-sandbox-pass">Finish as a test: pass</button>
                      <button type="button" onClick={() => finishSandbox("red")} className={link}>Finish as a test: fail</button>
                    </>
                  )}
                </div>
              )}
              {c.state === "unavailable" && <p className="mt-2 text-sm text-muted">The document check is not available yet.</p>}
            </li>
          ))}
        </ul>
        {data.kyc.sandbox && <p className="mt-3 text-sm text-muted">Test mode: this check uses a practice partner. No documents are asked for or kept.</p>}
        {message && <p role="status" className="mt-3 text-sm text-danger">{message}</p>}
      </Card>

      {data.badge && (
        <Card title="Shown on your public name">
          <p className="text-sm text-muted">Your level is published on <span className="font-mono">{data.badge.name}</span> so customers and software can check it before paying. Only Stenmont can write it, so it cannot be faked.</p>
          <p className="mt-2 text-sm" data-testid="badge">{data.badge.publishedTier === null ? "Not published yet." : `Published: level ${data.badge.publishedTier}.`}</p>
          <button type="button" onClick={publish} className={`mt-3 ${link}`}>Update it now</button>
        </Card>
      )}

      <WalletConnect />
    </div>
  );
}
