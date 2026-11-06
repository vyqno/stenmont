"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { toUnits } from "@stenmont/shared";
import { createPasskey, loadPasskey, signDigest } from "../../../lib/passkey";
import { ZERO_SALT, apiBase, formatAmount, friendly, isTestEnvironment } from "../../../lib/pay";
import { cancelDigest, permitDigest, permitValue, planCopy, subscribeDigest, signingTerms, type Terms } from "../../../lib/subscribe";

type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "awaiting" }
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
        if (t?.preparationRequired) return setView({ kind: "awaiting" });
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

      if (toUnits(info.balance) < toUnits(terms.segments?.[0]?.amount ?? terms.amount)) {
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
      const segmentSignatures = [];
      for (const agreement of signingTerms(terms)) segmentSignatures.push(await signDigest(key, subscribeDigest(agreement, info.address, deadline)));
      const payerSig = segmentSignatures[0]!;
      step("Confirm once more to allow the payments…");
      const permitDeadline = deadline;
      const permitSig = await signDigest(key, permitDigest(terms, info.address, { allowance: info.subscriptionAllowance, nonce: BigInt(info.permitNonce), deadline: permitDeadline }));

      step(planCopy(terms).working);
      const payload = {
        id: terms.id,
        payer: info.address,
        deadline: deadline.toString(),
        payerSig,
        segmentSignatures,
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
      const segmentSignatures = [];
      for (const agreement of signingTerms(terms)) segmentSignatures.push(await signDigest(key, cancelDigest(agreement, deadline)));
      const payerSig = segmentSignatures[0]!;
      const res = await post(apiBase(location.hostname), "/relay/subscription-cancel", { id: terms.id, deadline: deadline.toString(), payerSig, segmentSignatures });
      if (!res.ok) throw new StepError(res.json.error?.code ?? "chain_error");
      setView({ kind: "active", terms, ended: true });
    } catch (e) {
      const code = e instanceof StepError ? e.code : "cancelled";
      setView({ kind: "ready", terms: { ...terms, status: "offered" }, notice: friendly(code) });
    }
  }, []);

  const copy = view.kind === "loading" || view.kind === "missing" || view.kind === "awaiting" ? null : planCopy(view.terms);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12" data-testid="subscribe-page">
      {view.kind === "loading" && <p role="status">Loading…</p>}
      {view.kind === "awaiting" && <p role="status">The business needs to prepare this replacement payment plan before you can agree. Ask them to open Subscriptions and prepare the plan.</p>}
      {view.kind === "missing" && (
        <>
          <h1 className="text-2xl font-semibold">This subscription isn&apos;t available</h1>
          <p className="text-muted">It may have ended, or the link may be wrong.</p>
        </>
      )}

      {(view.kind === "ready" || view.kind === "working") && (
        <>
          <div>
            <p className="text-muted">{copy!.title}</p>
            {copy!.forBusiness && <p className="mt-0.5 text-xs text-muted" data-testid="for-business">{copy!.forBusiness}</p>}
            <h1 className="amount mt-1 text-5xl font-bold tracking-tight" data-testid="amount">
              {formatAmount(view.terms.segments?.[0]?.amount ?? view.terms.amount)}
            </h1>
            <p className="mt-2 text-muted" data-testid="schedule">
              {copy!.schedule}
            </p>
            {copy!.total && <p className="mt-1 text-sm text-muted" data-testid="plan-total">{copy!.total}</p>}
          </div>
          {view.kind === "ready" && (
            <>
              {view.notice && (
                <p role="alert" data-testid="notice" className="rounded-md border border-danger p-3 text-sm text-danger">
                  {view.notice}
                </p>
              )}
              <button type="button" onClick={() => subscribe(view.terms)} className="rounded-lg bg-brand px-6 py-4 text-lg font-medium text-white">
                {copy!.button}
              </button>
              <p className="text-sm text-muted">{copy!.consent}</p>
              <p className="text-sm text-muted" data-testid="visibility">{copy!.visibility}</p>
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
            {view.ended ? (view.terms.kind === "instalment" ? "Payment plan stopped" : "Subscription cancelled") : copy!.done}
          </h1>
          <p className="text-lg">
            {view.ended
              ? `No more payments will be taken by ${view.terms.merchantName}.`
              : copy!.doneText}
          </p>
          {!view.ended && (
            <button type="button" onClick={() => cancel(view.terms)} className="self-start rounded border border-line px-4 py-2 text-sm hover:border-danger" data-testid="cancel-subscription">
              {view.terms.kind === "instalment" ? "Stop the plan" : "Cancel subscription"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
