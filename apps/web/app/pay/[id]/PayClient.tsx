"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Hex } from "viem";
import { toUnits } from "@stenmont/shared";
import { Logo } from "../../../components/Logo";
import FundingHelp from "../../../components/FundingHelp";
import { ACCOUNT_COPY, accountUrl, saveAccountToken } from "../../../lib/account";
import { createPasskey, loadPasskey, signDigest } from "../../../lib/passkey";
import { describeTrust, type Trust } from "../../../lib/trust";
import { ZERO_SALT, apiBase, formatAmount, friendly, payChallenge, payViewKind, routerFor } from "../../../lib/pay";
import { WALLET_COPY, WalletError, injectedProvider, signWalletPayment, walletBalance, type Eip1193 } from "../../../lib/wallet";

type Invoice = {
  id: string;
  number: string;
  status: string;
  amount: string;
  amountPaid: string;
  remaining: string;
  merchantName: string;
  payeeName?: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  paused?: boolean;
  trust?: Trust;
  /** Business-to-business invoices may be paid in parts: the plan the buyer can take up instead. */
  instalments?: { count: number; each: string; url: string } | null;
};
type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "paused"; invoice: Invoice }
  | { kind: "ready"; invoice: Invoice; notice?: string }
  | { kind: "working"; invoice: Invoice; step: string }
  | { kind: "paid"; invoice: Invoice; receipt: string | null; keepLink: string | null };

const noSubscribe = () => () => {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const random32 = () => (`0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`) as Hex;

class PayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { ok: res.ok, json };
}

/** Sends a signed payment through the relay (the relayer pays the fees). "Busy" is momentary, so the same approval is sent again without a second prompt. */
async function sendPayment(base: string, payload: unknown) {
  let sent = await post(base, "/relay/pay", payload);
  for (let attempt = 1; attempt <= 3 && !sent.ok && sent.json.error?.code === "busy"; attempt++) {
    await sleep(2_000 * attempt);
    sent = await post(base, "/relay/pay", payload);
  }
  if (!sent.ok) throw new PayError(sent.json.error?.code ?? "chain_error");
  return sent.json;
}

/** The page after a payment: the receipt, and a link back to every receipt this person has (also remembered on this device). */
function paidView(invoice: Invoice, sent: Record<string, unknown>): View {
  const txHash = sent.txHash as string | undefined;
  const token = sent.accountToken as string | undefined;
  if (token) saveAccountToken(localStorage, token);
  return { kind: "paid", invoice, receipt: txHash ? `https://explorer.testnet.whitechain.io/tx/${txHash}` : null, keepLink: token ? accountUrl(location.origin, token) : null };
}

export default function PayClient({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  // The browser's wallet, if any. The server render has none, so the server and the first client render agree.
  const provider = useSyncExternalStore(noSubscribe, () => injectedProvider(window), () => null);

  useEffect(() => {
    let alive = true;
    fetch(`${apiBase(location.hostname)}/pay/${id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Invoice) : null))
      .then((invoice) => {
        if (!alive) return;
        if (!invoice) return setView({ kind: "missing" });
        const kind = payViewKind(invoice);
        setView(kind === "ready" ? { kind, invoice } : kind === "paid" ? { kind, invoice, receipt: null, keepLink: null } : kind === "paused" ? { kind, invoice } : { kind: "missing" });
      })
      .catch(() => alive && setView({ kind: "missing" }));
    return () => {
      alive = false;
    };
  }, [id]);

  const pay = useCallback(async (invoice: Invoice) => {
    const host = location.hostname;
    const base = apiBase(host);
    const step = (s: string) => setView({ kind: "working", invoice, step: s });
    try {
      step("Setting things up…");
      const key = loadPasskey() ?? (await createPasskey());
      const need = toUnits(invoice.remaining);

      const account = await post(base, "/relay/account", { qx: key.qx, qy: key.qy, salt: ZERO_SALT });
      const info = account.json as { address: Hex; balance: string };
      // A checkout may only spend funds the payer already owns, on every network.
      if (toUnits(info.balance) < need) throw new PayError("insufficient");

      step("Confirm on your device…");
      const salt = random32();
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      const signature = await signDigest(
        key,
        payChallenge({ account: info.address, router: routerFor(host), value: need, validBefore, invoiceId: invoice.id as Hex, salt }),
      );

      step("Sending your payment…");
      const payload = {
        invoiceId: invoice.id,
        value: invoice.remaining,
        payer: info.address,
        validAfter: "0",
        validBefore: validBefore.toString(),
        salt,
        signature,
        account: { qx: key.qx, qy: key.qy, salt: ZERO_SALT },
      };
      setView(paidView(invoice, await sendPayment(base, payload)));
    } catch (e) {
      const code = e instanceof PayError ? e.code : e instanceof DOMException && e.name === "NotAllowedError" ? "cancelled" : "unknown";
      setView({ kind: "ready", invoice, notice: code === "insufficient" ? "You don't have enough funds for this payment." : friendly(code) });
    }
  }, []);

  /** The same payment, signed by a wallet the person already has in this browser instead of a new passkey. Same relay, same fees paid for them. */
  const payWithWallet = useCallback(async (invoice: Invoice, eth: Eip1193) => {
    const host = location.hostname;
    const base = apiBase(host);
    const step = (s: string) => setView({ kind: "working", invoice, step: s });
    try {
      step("Confirm in your app…");
      const need = toUnits(invoice.remaining);
      const salt = random32();
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      const { payer, signature } = await signWalletPayment(eth, { router: routerFor(host), invoiceId: invoice.id as Hex, value: need, validBefore, salt }, async (who) => {
        if ((await walletBalance(eth, who)) < need) throw new WalletError("wallet_insufficient");
      });
      step("Sending your payment…");
      const sent = await sendPayment(base, { invoiceId: invoice.id, value: invoice.remaining, payer, validAfter: "0", validBefore: validBefore.toString(), salt, signature });
      setView(paidView(invoice, sent));
    } catch (e) {
      const code = e instanceof PayError || e instanceof WalletError ? e.code : "unknown";
      setView({ kind: "ready", invoice, notice: friendly(code) });
    }
  }, []);

  // After paying, the customer goes back to the shop that sent them (a return link only the merchant can set).
  const returnTo = view.kind === "paid" ? view.invoice.successUrl : null;
  useEffect(() => {
    if (!returnTo) return;
    const t = setTimeout(() => location.assign(returnTo), 3_000);
    return () => clearTimeout(t);
  }, [returnTo]);

  return (
    <main className="payment-sheet" data-testid="pay-page">
      <header className="payment-header"><Logo /><span>Test network</span></header>
      {view.kind === "loading" && <p role="status">Loading…</p>}

      {view.kind === "missing" && (
        <>
          <h1 className="text-2xl font-semibold">This invoice can&apos;t be paid</h1>
          <p className="text-muted">It may have been paid already, cancelled, or the link may be wrong.</p>
        </>
      )}

      {view.kind === "paused" && (
        <div data-testid="paused">
          <h1 className="text-2xl font-semibold">Payments are temporarily unavailable</h1>
          <p className="mt-2 text-muted">{view.invoice.merchantName} has paused payments for now. Nothing was charged. Please try again later or contact them.</p>
          {view.invoice.cancelUrl && (
            <a className="mt-4 inline-block text-sm underline" href={view.invoice.cancelUrl}>
              Go back to {view.invoice.merchantName}
            </a>
          )}
        </div>
      )}

      {(view.kind === "ready" || view.kind === "working") && (
        <>
          <div>
            <p className="text-muted">Pay {view.invoice.merchantName}</p>
            {view.invoice.payeeName && (
              <p className="mt-0.5 text-xs text-muted" data-testid="payee-name">
                Paying {view.invoice.payeeName}
              </p>
            )}
            <TrustBadge trust={view.invoice.trust} />
            <h1 className="mt-1 text-5xl font-semibold tracking-tight" data-testid="amount">
              {formatAmount(view.invoice.remaining)}
            </h1>
            <p className="mt-2 text-sm text-muted">Invoice {view.invoice.number}</p>
          </div>
          {view.kind === "ready" && (
            <>
              {view.notice && (
                <p role="alert" data-testid="notice" className="rounded-md border border-danger p-3 text-sm text-danger">
                  {view.notice}
                </p>
              )}
              <button
                type="button"
                onClick={() => pay(view.invoice)}
                className="rounded-lg bg-foreground px-6 py-4 text-lg font-medium text-white hover:bg-neutral-800"
              >
                Pay {formatAmount(view.invoice.remaining)}
              </button>
              <p className="text-sm text-muted">You&apos;ll confirm with Face ID, your fingerprint or your device PIN. Nothing to install.</p>
              {view.invoice.instalments && (
                <a href={view.invoice.instalments.url} className="text-sm underline" data-testid="pay-in-parts">
                  Business buyer? Pay in {view.invoice.instalments.count} parts of {formatAmount(view.invoice.instalments.each)}
                </a>
              )}

              {provider && (
                <div data-testid="wallet-option">
                  <button type="button" onClick={() => payWithWallet(view.invoice, provider)} className="rounded-lg border border-control px-6 py-3 font-medium hover:border-black" data-testid="pay-with-wallet">
                    {WALLET_COPY.button}
                  </button>
                  <p className="mt-1 text-sm text-muted">{WALLET_COPY.hint}</p>
                </div>
              )}
              <FundingHelp />
              {view.invoice.cancelUrl && (
                <a className="text-sm underline" href={view.invoice.cancelUrl} data-testid="cancel-link">
                  Cancel and go back to {view.invoice.merchantName}
                </a>
              )}
            </>
          )}
          {view.kind === "working" && (
            <p role="status" aria-live="polite" className="text-lg" data-testid="step">
              {view.step}
            </p>
          )}
        </>
      )}

      {view.kind === "paid" && (
        <>
          <h1 className="text-5xl font-semibold tracking-tight" data-testid="paid">
            Paid
          </h1>
          <p className="text-lg">
            Thank you. {view.invoice.merchantName} has your payment of {formatAmount(view.invoice.remaining === "0" ? view.invoice.amount : view.invoice.remaining)}.
          </p>
          {view.invoice.successUrl && (
            <a className="underline" href={view.invoice.successUrl} data-testid="return-link">
              Return to {view.invoice.merchantName}
            </a>
          )}
          {view.receipt && (
            <a className="underline" href={view.receipt} target="_blank" rel="noreferrer">
              View receipt
            </a>
          )}
          {view.keepLink && (
            <div className="rounded-lg border border-line p-4 text-sm" data-testid="keep-link">
              <p className="font-medium">{ACCOUNT_COPY.keep}</p>
              <a className="mt-1 block break-all underline" href={view.keepLink} data-testid="keep-link-url">
                {view.keepLink.split("#")[0]}
              </a>
              <p className="mt-1 text-muted">{ACCOUNT_COPY.keepHint}</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** "Verified business" with the specific proofs that hold. The wording lives in lib/trust.ts. */
function TrustBadge({ trust }: { trust?: Trust }) {
  const t = describeTrust(trust);
  if (!t) return null;
  return (
    <div className="mt-3 rounded-md border border-line p-3 text-sm" data-testid="trust-badge">
      <p className={t.verified ? "font-medium" : "text-muted"}>{t.headline}</p>
      {t.proofs.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {t.proofs.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {t.level && <p className="mt-1 text-xs text-muted">{t.level}</p>}
      {t.note && <p className="mt-1 text-xs text-muted">{t.note}</p>}
    </div>
  );
}
