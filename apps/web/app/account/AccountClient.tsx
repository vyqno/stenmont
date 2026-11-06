"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { Logo } from "../../components/Logo";
import FundingHelp from "../../components/FundingHelp";
import { ACCOUNT_COPY, fetchSummary, loadAccountToken, saveAccountToken, statusLabel, tokenFromHash, type Summary } from "../../lib/account";
import { loadPasskey, signDigest } from "../../lib/passkey";
import { ZERO_SALT, apiBase, formatAmount, friendly } from "../../lib/pay";
import { cancelDigest, describePeriod } from "../../lib/subscribe";
import { injectedProvider, signWalletCancel, WalletError } from "../../lib/wallet";

type View = { kind: "loading" } | { kind: "none" } | { kind: "invalid" } | { kind: "unavailable" } | { kind: "ready"; summary: Summary };
type Sub = Summary["subscriptions"][number];

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export default function AccountClient() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    const r = await fetchSummary(location.hostname, t);
    setView(r.ok ? { kind: "ready", summary: r.summary } : { kind: r.reason });
  }, []);

  useEffect(() => {
    void (async () => {
      const t = tokenFromHash(location.hash) ?? loadAccountToken(localStorage);
      if (!t) return setView({ kind: "none" });
      saveAccountToken(localStorage, t);
      setToken(t);
      await load(t);
    })();
  }, [load]);

  const cancel = useCallback(
    async (sub: Sub, payer: Hex) => {
      setBusy(sub.id);
      setNotice(null);
      try {
        const base = apiBase(location.hostname);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
        const terms = { id: sub.id, manager: sub.manager };
        let payerSig: Hex | null = null;
        const key = loadPasskey();
        if (key) {
          const res = await fetch(`${base}/relay/account`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qx: key.qx, qy: key.qy, salt: ZERO_SALT }) });
          const mine = res.ok ? ((await res.json()) as { address: string }).address : null;
          if (mine && mine.toLowerCase() === payer.toLowerCase()) payerSig = await signDigest(key, cancelDigest(terms, deadline));
        }
        const eth = injectedProvider(window);
        if (!payerSig && eth) payerSig = await signWalletCancel(eth, payer, { ...terms, deadline });
        if (!payerSig) {
          setNotice(ACCOUNT_COPY.cancelOtherDevice);
          return;
        }
        const out = await fetch(`${base}/relay/subscription-cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: sub.id, deadline: deadline.toString(), payerSig }) });
        if (!out.ok) {
          const code = ((await out.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? "unknown";
          setNotice(friendly(code));
          return;
        }
        setNotice(ACCOUNT_COPY.cancelled);
        if (token) await load(token);
      } catch (e) {
        setNotice(e instanceof WalletError ? friendly(e.code) : e instanceof DOMException && e.name === "NotAllowedError" ? friendly("cancelled") : friendly("unknown"));
      } finally {
        setBusy(null);
      }
    },
    [load, token],
  );

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-8 px-6 py-12" data-testid="account-page">
      <p className="mb-8 text-xl"><Logo /></p>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{ACCOUNT_COPY.title}</h1>
        <p className="mt-1 text-muted">{ACCOUNT_COPY.intro}</p>
      </header>

      {view.kind === "loading" && <p role="status">Loading…</p>}
      {view.kind === "none" && <p data-testid="account-none">{ACCOUNT_COPY.noLink}</p>}
      {view.kind === "invalid" && <p role="alert" data-testid="account-invalid">{ACCOUNT_COPY.expired}</p>}
      {view.kind === "unavailable" && <p role="alert" data-testid="account-unavailable">{ACCOUNT_COPY.unavailable}</p>}

      {notice && <p role="status" className="rounded border border-line p-3 text-sm" data-testid="account-notice">{notice}</p>}

      {view.kind === "ready" && (
        <>
          <section aria-labelledby="payments">
            <h2 id="payments" className="mb-2 text-xl font-semibold">Payments</h2>
            {view.summary.payments.length === 0 ? <p className="text-muted">{ACCOUNT_COPY.empty.payments}</p> : (
              <ul className="divide-y divide-line" data-testid="payments">
                {view.summary.payments.map((p) => (
                  <li key={p.receiptUrl} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{p.merchantName}</p>
                      <p className="text-sm text-muted">Invoice {p.invoiceNumber} · {when(p.at)}</p>
                    </div>
                    <div className="text-right">
                      <p>{formatAmount(p.amount)}</p>
                      <a className="text-sm underline" href={p.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="refunds">
            <h2 id="refunds" className="mb-2 text-xl font-semibold">Refunds</h2>
            {view.summary.refunds.length === 0 ? <p className="text-muted">{ACCOUNT_COPY.empty.refunds}</p> : (
              <ul className="divide-y divide-line" data-testid="refunds">
                {view.summary.refunds.map((r) => (
                  <li key={r.receiptUrl} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{r.merchantName}</p>
                      <p className="text-sm text-muted">Invoice {r.invoiceNumber} · {when(r.at)}</p>
                    </div>
                    <div className="text-right">
                      <p>{formatAmount(r.amount)} back to you</p>
                      <a className="text-sm underline" href={r.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="subscriptions">
            <h2 id="subscriptions" className="mb-2 text-xl font-semibold">Subscriptions</h2>
            {view.summary.subscriptions.length === 0 ? <p className="text-muted">{ACCOUNT_COPY.empty.subscriptions}</p> : (
              <ul className="divide-y divide-line" data-testid="subscriptions">
                {view.summary.subscriptions.map((s) => (
                  <li key={s.id} className="space-y-2 py-3" data-testid="subscription">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{s.merchantName}</p>
                        <p className="text-sm text-muted">{formatAmount(s.amount)} every {describePeriod(s.periodSeconds)} · {s.charges} of {s.maxCharges} paid</p>
                        {s.nextChargeAt && <p className="text-sm text-muted">Next payment {when(s.nextChargeAt)}</p>}
                      </div>
                      <span className="rounded border border-line px-2 py-0.5 text-sm" data-testid="subscription-status">{statusLabel(s.status)}</span>
                    </div>
                    {(s.status === "active" || s.status === "past_due") && (
                      <div>
                        <button type="button" disabled={busy === s.id} onClick={() => cancel(s, view.summary.payer)} className="rounded border border-line px-4 py-2 text-sm hover:border-danger disabled:opacity-40" data-testid="cancel-subscription">
                          {busy === s.id ? "Working…" : "Cancel subscription"}
                        </button>
                        <p className="mt-1 text-xs text-muted">{ACCOUNT_COPY.cancelHelp}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <FundingHelp />
    </main>
  );
}
