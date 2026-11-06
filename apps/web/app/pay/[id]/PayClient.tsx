"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import { toUnits } from "@stenmont/shared";
import { createPasskey, loadPasskey, signDigest } from "../../../lib/passkey";
import { ZERO_SALT, apiBase, formatAmount, friendly, isTestEnvironment, payChallenge, payViewKind, routerFor } from "../../../lib/pay";

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
};
type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "paused"; invoice: Invoice }
  | { kind: "ready"; invoice: Invoice; notice?: string }
  | { kind: "working"; invoice: Invoice; step: string }
  | { kind: "paid"; invoice: Invoice; receipt: string | null };

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

export default function PayClient({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`${apiBase(location.hostname)}/pay/${id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Invoice) : null))
      .then((invoice) => {
        if (!alive) return;
        if (!invoice) return setView({ kind: "missing" });
        const kind = payViewKind(invoice);
        setView(kind === "ready" ? { kind, invoice } : kind === "paid" ? { kind, invoice, receipt: null } : kind === "paused" ? { kind, invoice } : { kind: "missing" });
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

      let account = await post(base, "/relay/account", { qx: key.qx, qy: key.qy, salt: ZERO_SALT });
      let info = account.json as { address: Hex; balance: string };
      if (toUnits(info.balance) < need) {
        if (!isTestEnvironment(host)) throw new PayError("insufficient");
        step("Adding test funds…");
        const faucet = await post(base, "/relay/faucet", { address: info.address });
        if (!faucet.ok && toUnits(info.balance) < need) throw new PayError(faucet.json.error?.code ?? "faucet_limit");
        for (let i = 0; i < 25 && toUnits(info.balance) < need; i++) {
          await sleep(2_000);
          account = await post(base, "/relay/account", { qx: key.qx, qy: key.qy, salt: ZERO_SALT });
          info = account.json as { address: Hex; balance: string };
        }
        if (toUnits(info.balance) < need) throw new PayError("busy");
      }

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
      let sent = await post(base, "/relay/pay", payload);
      // "busy" is momentary (other payments are in flight): the same approval is simply sent again, no second prompt
      for (let attempt = 1; attempt <= 3 && !sent.ok && sent.json.error?.code === "busy"; attempt++) {
        await sleep(2_000 * attempt);
        sent = await post(base, "/relay/pay", payload);
      }
      if (!sent.ok) throw new PayError(sent.json.error?.code ?? "chain_error");
      const txHash = sent.json.txHash as string | undefined;
      setView({
        kind: "paid",
        invoice,
        receipt: txHash ? `https://explorer.testnet.whitechain.io/tx/${txHash}` : null,
      });
    } catch (e) {
      const code = e instanceof PayError ? e.code : e instanceof DOMException && e.name === "NotAllowedError" ? "cancelled" : "unknown";
      setView({ kind: "ready", invoice, notice: code === "insufficient" ? "You don't have enough funds for this payment." : friendly(code) });
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12" data-testid="pay-page">
      {view.kind === "loading" && <p role="status">Loading…</p>}

      {view.kind === "missing" && (
        <>
          <h1 className="text-2xl font-semibold">This invoice can&apos;t be paid</h1>
          <p className="text-neutral-500">It may have been paid already, cancelled, or the link may be wrong.</p>
        </>
      )}

      {view.kind === "paused" && (
        <div data-testid="paused">
          <h1 className="text-2xl font-semibold">Payments are temporarily unavailable</h1>
          <p className="mt-2 text-neutral-500">{view.invoice.merchantName} has paused payments for now. Nothing was charged. Please try again later or contact them.</p>
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
            <p className="text-neutral-500">Pay {view.invoice.merchantName}</p>
            {view.invoice.payeeName && (
              <p className="mt-0.5 text-xs text-neutral-500" data-testid="payee-name">
                Paying {view.invoice.payeeName}
              </p>
            )}
            <h1 className="mt-1 text-5xl font-semibold tracking-tight" data-testid="amount">
              {formatAmount(view.invoice.remaining)}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">Invoice {view.invoice.number}</p>
          </div>
          {view.kind === "ready" && (
            <>
              {view.notice && (
                <p role="alert" data-testid="notice" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                  {view.notice}
                </p>
              )}
              <button
                type="button"
                onClick={() => pay(view.invoice)}
                className="rounded-lg bg-black px-6 py-4 text-lg font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                Pay {formatAmount(view.invoice.remaining)}
              </button>
              <p className="text-sm text-neutral-500">You&apos;ll confirm with Face ID, your fingerprint or your device PIN. Nothing to install.</p>
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
        </>
      )}
    </main>
  );
}
