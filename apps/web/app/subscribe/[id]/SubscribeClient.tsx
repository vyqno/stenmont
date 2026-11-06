"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { toUnits } from "@stenmont/shared";
import { createPasskey, loadPasskey, signDigest } from "../../../lib/passkey";
import { ZERO_SALT, apiBase, formatAmount, friendly, isTestEnvironment } from "../../../lib/pay";
import { cancelDigest, describePeriod, permitDigest, permitValue, subscribeDigest, type Terms } from "../../../lib/subscribe";

type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; terms: Terms; notice?: string }
  | { kind: "working"; terms: Terms; step: string }
  | { kind: "active"; terms: Terms; ended?: boolean };

class StepError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { ok: res.ok, json };
}

export default function SubscribeClient({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`${apiBase(location.hostname)}/pay/subscription/${id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Terms) : null))
      .then((t) => {
        if (!alive) return;
        if (!t) return setView({ kind: "missing" });
        setView(t.status === "offered" ? { kind: "ready", terms: t } : t.status === "active" ? { kind: "active", terms: t } : { kind: "missing" });
      })
      .catch(() => alive && setView({ kind: "missing" }));
    return () => {
      alive = false;
    };
  }, [id]);

  const subscribe = useCallback(async (terms: Terms) => {
    const host = location.hostname;
    const base = apiBase(host);
    const step = (s: string) => setView({ kind: "working", terms, step: s });
    try {
      step("Setting things up…");
      const key = loadPasskey() ?? (await createPasskey());
      const lookup = () => post(base, "/relay/account", { qx: key.qx, qy: key.qy, salt: ZERO_SALT });
      let info = (await lookup()).json as { address: Hex; balance: string; permitNonce: string; subscriptionAllowance: string };

      if (toUnits(info.balance) < toUnits(terms.amount)) {
        if (!isTestEnvironment(host)) throw new StepError("insufficient");
        step("Adding test funds…");
        const faucet = await post(base, "/relay/faucet", { address: info.address });
        if (!faucet.ok && toUnits(info.balance) < toUnits(terms.amount)) throw new StepError(faucet.json.error?.code ?? "faucet_limit");
        for (let i = 0; i < 25 && toUnits(info.balance) < toUnits(terms.amount); i++) {
          await sleep(2_000);
          info = (await lookup()).json as typeof info;
        }
        if (toUnits(info.balance) < toUnits(terms.amount)) throw new StepError("busy");
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      step("Confirm the agreement on your device…");
      const payerSig = await signDigest(key, subscribeDigest(terms, info.address, deadline));
      step("Confirm once more to allow the payments…");
      const permitDeadline = deadline;
      const permitSig = await signDigest(key, permitDigest(terms, info.address, { allowance: info.subscriptionAllowance, nonce: BigInt(info.permitNonce), deadline: permitDeadline }));

      step("Starting your subscription…");
      const payload = {
        id: terms.id,
        payer: info.address,
        deadline: deadline.toString(),
        payerSig,
        permitValue: permitValue(terms, info.subscriptionAllowance).toString(),
        permitDeadline: permitDeadline.toString(),
        permitSig,
        account: { qx: key.qx, qy: key.qy, salt: ZERO_SALT },
      };
      let sent = await post(base, "/relay/subscribe", payload);
      for (let attempt = 1; attempt <= 3 && !sent.ok && sent.json.error?.code === "busy"; attempt++) {
        await sleep(2_000 * attempt);
        sent = await post(base, "/relay/subscribe", payload);
      }
      if (!sent.ok) throw new StepError(sent.json.error?.code ?? "chain_error");
      setView({ kind: "active", terms });
    } catch (e) {
      const code = e instanceof StepError ? e.code : e instanceof DOMException && e.name === "NotAllowedError" ? "cancelled" : "unknown";
      setView({ kind: "ready", terms, notice: code === "insufficient" ? "You don't have enough funds for the first payment." : friendly(code) });
    }
  }, []);

  const cancel = useCallback(async (terms: Terms) => {
    const key = loadPasskey();
    if (!key) return setView({ kind: "active", terms });
    setView({ kind: "working", terms, step: "Confirm on your device…" });
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      const payerSig = await signDigest(key, cancelDigest(terms, deadline));
      const res = await post(apiBase(location.hostname), "/relay/subscription-cancel", { id: terms.id, deadline: deadline.toString(), payerSig });
      if (!res.ok) throw new StepError(res.json.error?.code ?? "chain_error");
      setView({ kind: "active", terms, ended: true });
    } catch (e) {
      const code = e instanceof StepError ? e.code : "cancelled";
      setView({ kind: "ready", terms: { ...terms, status: "offered" }, notice: friendly(code) });
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12" data-testid="subscribe-page">
      {view.kind === "loading" && <p role="status">Loading…</p>}
      {view.kind === "missing" && (
        <>
          <h1 className="text-2xl font-semibold">This subscription isn&apos;t available</h1>
          <p className="text-muted">It may have ended, or the link may be wrong.</p>
        </>
      )}

      {(view.kind === "ready" || view.kind === "working") && (
        <>
          <div>
            <p className="text-muted">Subscribe to {view.terms.merchantName}</p>
            <h1 className="amount mt-1 text-5xl font-bold tracking-tight" data-testid="amount">
              {formatAmount(view.terms.amount)}
            </h1>
            <p className="mt-2 text-muted" data-testid="schedule">
              every {describePeriod(view.terms.periodSeconds)}, up to {view.terms.maxCharges} payments
            </p>
          </div>
          {view.kind === "ready" && (
            <>
              {view.notice && (
                <p role="alert" data-testid="notice" className="rounded-md border border-danger p-3 text-sm text-danger">
                  {view.notice}
                </p>
              )}
              <button type="button" onClick={() => subscribe(view.terms)} className="rounded-lg bg-brand px-6 py-4 text-lg font-medium text-on-brand">
                Subscribe for {formatAmount(view.terms.amount)}
              </button>
              <p className="text-sm text-muted">The first payment is taken now. You confirm twice with Face ID, your fingerprint or your device PIN, and you can cancel any time.</p>
            </>
          )}
          {view.kind === "working" && (
            <p role="status" aria-live="polite" className="text-lg" data-testid="step">
              {view.step}
            </p>
          )}
        </>
      )}

      {view.kind === "active" && (
        <>
          <h1 className="text-4xl font-bold tracking-tight" data-testid={view.ended ? "cancelled" : "subscribed"}>
            {view.ended ? "Subscription cancelled" : "You're subscribed"}
          </h1>
          <p className="text-lg">
            {view.ended
              ? `No more payments will be taken by ${view.terms.merchantName}.`
              : `${view.terms.merchantName} will take ${formatAmount(view.terms.amount)} every ${describePeriod(view.terms.periodSeconds)}, at most ${view.terms.maxCharges} times.`}
          </p>
          {!view.ended && (
            <button type="button" onClick={() => cancel(view.terms)} className="self-start rounded border border-line px-4 py-2 text-sm hover:border-danger" data-testid="cancel-subscription">
              Cancel subscription
            </button>
          )}
        </>
      )}
    </main>
  );
}
