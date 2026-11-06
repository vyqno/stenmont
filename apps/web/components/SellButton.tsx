"use client";

import Link from "next/link";
import { useState } from "react";
import { useMerchant } from "../app/dashboard/DashboardShell";
import { AuthError, api, signChallenge } from "../lib/auth";
import { MAX_DISCOUNT_PCT, MAX_RESERVE_PCT, financingMessage, quoteSale } from "../lib/financing";
import { formatAmount } from "../lib/pay";
import { primaryButton } from "./ui";

type Step = "closed" | "form" | "working" | "done";
type Listing = { id: string; challenges: { terms: string; hook: string } };

/** "Get paid early": offer one open, unpaid invoice to investors at a discount. Two passkey taps: the terms, then the payout route. */
export function SellButton({ invoiceId, face, onDone }: { invoiceId: string; face: string; onDone?: () => void }) {
  const merchant = useMerchant();
  const [step, setStep] = useState<Step>("closed");
  const [discount, setDiscount] = useState("3");
  const [reserve, setReserve] = useState("10");
  const [message, setMessage] = useState("");
  const [notVerified, setNotVerified] = useState(false);
  const quote = quoteSale(face, discount, reserve);

  async function sell() {
    if (!quote) return;
    setStep("working");
    setMessage("");
    setNotVerified(false);
    try {
      const d = Math.round(Number(discount) * 100);
      const r = Math.round(Number(reserve) * 100);
      const listing = await api.post<Listing>("/v1/financing/listings", { invoiceId, discountBps: d, reserveBps: r });
      const terms = await signChallenge(listing.challenges.terms, merchant.credentialId);
      const hook = await signChallenge(listing.challenges.hook, merchant.credentialId);
      await api.post(`/v1/financing/listings/${listing.id}/submit`, { terms, hook });
      setStep("done");
      onDone?.();
    } catch (e) {
      setStep("form");
      if (e instanceof AuthError) {
        if (e.code === "not_verified") setNotVerified(true);
        setMessage(financingMessage(e.code, e.message));
      } else setMessage("The listing could not be sent. Try again.");
    }
  }

  if (step === "done") return <span data-testid="listed" className="text-sm font-medium">Listed for investors</span>;
  if (step === "closed")
    return (
      <button type="button" onClick={() => setStep("form")} className="rounded border border-line px-3 py-1 hover:border-brand" data-testid="sell-open">
        Sell this invoice
      </button>
    );

  return (
    <div className="flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left text-sm" data-testid="sell-panel">
      <p className="font-medium">Get paid early</p>
      <label className="flex flex-col gap-1">
        Discount for the investor (%, up to {MAX_DISCOUNT_PCT})
        <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="amount rounded border border-line bg-transparent px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        Held back until the customer pays (%, up to {MAX_RESERVE_PCT})
        <input value={reserve} onChange={(e) => setReserve(e.target.value)} inputMode="decimal" className="amount rounded border border-line bg-transparent px-2 py-1" />
      </label>
      {quote ? (
        <dl className="grid grid-cols-2 gap-x-2 text-muted" data-testid="sell-quote">
          <dt>Invoice</dt><dd className="amount text-right">{formatAmount(face)}</dd>
          <dt>Investor pays</dt><dd className="amount text-right">{formatAmount(quote.price)}</dd>
          <dt>Held back</dt><dd className="amount text-right">{formatAmount(quote.reserve)}</dd>
          <dt className="font-medium text-foreground">Cash today</dt><dd className="amount text-right font-medium text-foreground" data-testid="sell-advance">{formatAmount(quote.advance)}</dd>
        </dl>
      ) : (
        <p className="text-danger" data-testid="sell-invalid">Enter a discount from 0.01 to {MAX_DISCOUNT_PCT} and a held-back share from 0 to {MAX_RESERVE_PCT}.</p>
      )}
      {message && (
        <p role="status" data-testid="sell-error" className="text-danger">
          {message}{" "}
          {notVerified && <Link href="/dashboard/settings" className="underline">Settings, Verify your business</Link>}
        </p>
      )}
      <p className="text-xs text-muted">You will confirm twice on your device.</p>
      <div className="flex gap-2">
        <button type="button" onClick={sell} disabled={!quote || step === "working"} className={`rounded px-3 py-1 font-medium ${primaryButton}`} data-testid="sell-submit">
          {step === "working" ? "Confirm on your device…" : "List for investors"}
        </button>
        <button type="button" onClick={() => setStep("closed")} disabled={step === "working"} className="rounded border border-line px-3 py-1 disabled:opacity-50">Close</button>
      </div>
    </div>
  );
}
