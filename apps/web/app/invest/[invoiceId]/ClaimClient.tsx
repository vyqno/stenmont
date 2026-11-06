"use client";

import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { Card } from "../../../components/ui";
import { describeReputation, explorerTx, financingMessage, formatYield } from "../../../lib/financing";
import { InvestError, call, ensureAccount, fund, isAllowed, lookupAccount, type AccountInfo, type Claim } from "../../../lib/investor";
import { loadPasskey, type StoredPasskey } from "../../../lib/passkey";
import { formatAmount } from "../../../lib/pay";

type Setup = { app_id: string; environment: "staging" | "production"; action: string; rp_context: RpContext };
const errText = (e: unknown) => (e instanceof InvestError ? financingMessage(e.code, "Something went wrong. Please try again.") : "Something went wrong. Please try again.");

export default function ClaimClient({ invoiceId }: { invoiceId: string }) {
  const [claim, setClaim] = useState<Claim | null | "missing">(null);
  const [key, setKey] = useState<StoredPasskey | null>(null);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [funded, setFunded] = useState(false);

  const check = useCallback(async (k: StoredPasskey, i: AccountInfo) => {
    try { setAllowed(await isAllowed(invoiceId, i.address)); } catch (e) {
      // a claim that was just bought by someone else is shown as such below
      setAllowed(false);
      setMessage(errText(e));
    }
  }, [invoiceId]);

  useEffect(() => {
    let alive = true;
    call<Claim>("GET", `/invest/claims/${invoiceId}`).then(
      (c) => alive && setClaim(c),
      () => alive && setClaim("missing"),
    );
    Promise.resolve(loadPasskey()).then((k) => {
      if (!k || !alive) return;
      setKey(k);
      return lookupAccount(k).then((i) => { if (alive) { setInfo(i); void check(k, i); } });
    }).catch(() => {});
    return () => { alive = false; };
  }, [invoiceId, check]);

  async function createAccount() {
    setBusy("Setting things up…"); setMessage("");
    try {
      const a = await ensureAccount();
      setKey(a.key); setInfo(a.info);
      await check(a.key, a.info);
    } catch (e) {
      setMessage(e instanceof DOMException || (e instanceof Error && e.message === "cancelled") ? financingMessage("cancelled") : errText(e));
    } finally { setBusy(""); }
  }

  async function startVerify() {
    if (!info) return;
    setMessage("");
    try {
      setSetup(await call<Setup>("POST", "/invest/allow-request", { account: info.address }));
      setOpen(true);
    } catch (e) { setMessage(errText(e)); }
  }

  async function buy() {
    if (!key || !info) return;
    setBusy("Setting things up…"); setMessage("");
    try {
      const tx = await fund(invoiceId, key, info, setBusy);
      setReceipt(explorerTx(tx));
      setFunded(true);
    } catch (e) { setMessage(errText(e)); } finally { setBusy(""); }
  }

  if (claim === null) return <p role="status">Loading…</p>;
  if (claim === "missing")
    return (
      <Card>
        <h1 className="text-2xl font-bold">This invoice isn&apos;t for sale</h1>
        <p className="mt-2 text-muted">It may have been bought already, or the offer ended. <Link href="/invest" className="underline">See what is for sale</Link>.</p>
      </Card>
    );

  const c = claim;
  return (
    <main className="flex flex-col gap-6" data-testid="claim-page">
      <div>
        <p className="text-muted">Invoice from</p>
        <h1 className="text-3xl font-bold">{c.merchant.name}</h1>
        <p className="text-sm text-muted">{describeReputation(c.merchant.reputation)}</p>
      </div>
      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-muted">You pay</dt><dd className="amount text-xl font-bold" data-testid="claim-price">{formatAmount(c.price)}</dd></div>
          <div><dt className="text-muted">Customer owes</dt><dd className="amount text-xl font-bold">{formatAmount(c.face)}</dd></div>
          <div><dt className="text-muted">Yield if paid on the due date</dt><dd className="amount text-xl font-bold">{formatYield(c.yieldToDueDate)}</dd></div>
          <div><dt className="text-muted">Due</dt><dd className="amount text-xl font-bold">{c.dueDate.slice(0, 10)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted">The customer&apos;s payment history: {describeReputation(c.payer.reputation)}. The yield is not guaranteed.</p>
        <p className="mt-2 text-sm" data-testid="risk-note">If the customer does not pay, you receive the held-back reserve ({formatAmount(c.reserve)}) after the grace period.</p>
      </Card>

      {funded ? (
        <Card>
          <h2 className="text-2xl font-bold" data-testid="funded">Funded</h2>
          <p className="mt-1">You bought this invoice for {formatAmount(c.price)}.</p>
          <div className="mt-3 flex gap-4">
            {receipt && <a className="underline" href={receipt} target="_blank" rel="noreferrer">View receipt</a>}
            <Link className="underline" href="/invest/portfolio">Your portfolio</Link>
          </div>
        </Card>
      ) : (
        <Card>
          <ol className="flex flex-col gap-5">
            <li>
              <h2 className="font-bold">1. Verify you are a real person</h2>
              <p className="text-sm text-muted">Each investor account is tied to one real person, so nobody can pretend to be many buyers. We learn nothing else about you.</p>
              <div className="mt-2">
                {!info && <button type="button" onClick={createAccount} disabled={!!busy} className="rounded bg-brand px-4 py-2 text-sm font-medium text-on-brand disabled:opacity-50" data-testid="invest-start">{busy || "Create your investor account"}</button>}
                {info && allowed === null && <p className="text-sm text-muted">Checking…</p>}
                {info && allowed === true && <p className="text-sm font-medium" data-testid="verified">Verified</p>}
                {info && allowed === false && (
                  <button type="button" onClick={startVerify} className="rounded bg-brand px-4 py-2 text-sm font-medium text-on-brand" data-testid="verify-start">Verify with World ID</button>
                )}
              </div>
            </li>
            <li>
              <h2 className="font-bold">2. Fund</h2>
              <p className="text-sm text-muted">Pay {formatAmount(c.price)} and confirm with Face ID, your fingerprint or your device PIN.</p>
              <button type="button" onClick={buy} disabled={allowed !== true || !!busy} className="mt-2 rounded bg-brand px-4 py-2 text-sm font-medium text-on-brand disabled:opacity-50" data-testid="fund-button">
                {busy || `Buy for ${formatAmount(c.price)}`}
              </button>
            </li>
          </ol>
          {message && <p role="status" data-testid="invest-message" className="mt-3 text-sm text-danger">{message}</p>}
        </Card>
      )}

      {setup && info && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o && allowed !== true) setMessage((m) => m || "Verification was cancelled. You can try again.");
          }}
          app_id={setup.app_id as `app_${string}`}
          action={setup.action}
          rp_context={setup.rp_context}
          environment={setup.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman()}
          handleVerify={async (result: IDKitResult) => {
            try {
              await call("POST", "/invest/allow", { account: info.address as Hex, idkitResponse: result });
            } catch (e) {
              setMessage(errText(e));
              throw e;
            }
          }}
          onSuccess={() => { setMessage(""); setAllowed(true); }}
        />
      )}
    </main>
  );
}
