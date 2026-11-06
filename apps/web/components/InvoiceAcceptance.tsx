"use client";
import { useCallback, useEffect, useState } from "react";
import { getTypesForEIP712Domain, type Address, type Hex } from "viem";
import { invoiceAckDomain, invoiceAckTypes, toUnits } from "@stenmont/shared";
import { assertPaymentPayer, type InvoiceProtocol } from "../lib/v2Payment";
import { acknowledgementDigest, challengeDeadline } from "../lib/v2Invoice";
import { apiBase, ZERO_SALT } from "../lib/pay";
import { verifyFreshInvoice } from "../lib/v2Chain";
import { loadPasskey, signDigest } from "../lib/passkey";
import type { Eip1193 } from "../lib/wallet";

type Quote = { acknowledged: boolean; suggestedDiscountBps: number; buyerRecord: { onTimeCounterparties: number }; advisory: boolean };
type AckRequest = { contractVersion: string; routerAddress: Address; ackAddress: Address; buyer: Address; nonce: string; deadline: number; digest: Hex };
type Props = { invoice: InvoiceProtocol & { id: string; amount: string; amountPaid: string; remaining: string; dueDate?: string | null }; provider: Eip1193 | null };
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(apiBase(location.hostname) + path, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message ?? "The acceptance could not be recorded.");
  return json as T;
}
/** Acceptance is voluntary evidence of invoice/delivery receipt and no current dispute, never a payment approval. */
export function InvoiceAcceptance({ invoice, provider }: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = useCallback(() => request<Quote>(`/pay/${invoice.id}/financing-quote`).then(setQuote).catch(() => {}), [invoice.id]);
  useEffect(() => { if (invoice.contractVersion === "v2" && invoice.payerLock) void refresh(); }, [invoice.contractVersion, invoice.payerLock, refresh]);
  if (invoice.contractVersion !== "v2" || !invoice.payerLock || !invoice.dueDate) return null;
  async function accept(wallet: boolean) {
    setBusy(true); setMessage("");
    try {
      await verifyFreshInvoice(invoice);
      const key = wallet ? null : loadPasskey();
      if (!wallet && !key) throw new Error("Use the named buyer’s existing account to accept this invoice.");
      const buyer = wallet ? (await provider!.request({ method: "eth_requestAccounts" }) as Address[])[0]! : (await request<{ address: Address }>("/relay/account", { qx: key!.qx, qy: key!.qy, salt: ZERO_SALT })).address;
      assertPaymentPayer(invoice, buyer);
      const challenge = await request<AckRequest>(`/pay/${invoice.id}/ack-request`, { buyer });
      if (!process.env.NEXT_PUBLIC_INVOICE_ACK_ADDRESS || challenge.ackAddress.toLowerCase() !== process.env.NEXT_PUBLIC_INVOICE_ACK_ADDRESS.toLowerCase()) throw new Error("The acceptance contract is not configured for this build.");
      const bound = { ...challenge, invoiceId: invoice.id as Hex, buyer, amount: invoice.amount, dueDate: invoice.dueDate! };
      if (challenge.contractVersion !== "v2" || challenge.routerAddress.toLowerCase() !== invoice.routerAddress?.toLowerCase() || challenge.buyer.toLowerCase() !== buyer.toLowerCase() || BigInt(challenge.deadline) <= BigInt(Math.floor(Date.now() / 1000)) || acknowledgementDigest(bound) !== challenge.digest) throw new Error("The acceptance details could not be verified.");
      let signature: Hex;
      if (wallet) {
        const domain = invoiceAckDomain(challenge.ackAddress);
        const typed = { domain, types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...invoiceAckTypes }, primaryType: "InvoiceAck", message: { invoiceId: invoice.id, amount: toUnits(invoice.amount), dueDate: BigInt(Math.floor(Date.parse(invoice.dueDate!) / 1000)), buyer, nonce: BigInt(challenge.nonce), deadline: BigInt(challenge.deadline) } };
        signature = await provider!.request({ method: "eth_signTypedData_v4", params: [buyer, JSON.stringify(typed, (_k, v) => typeof v === "bigint" ? v.toString() : v)] }) as Hex;
      } else signature = await signDigest(key!, challenge.digest);
      await request(`/pay/${invoice.id}/ack`, { buyer, deadline: challengeDeadline(challenge.deadline), signature });
      setMessage("Acceptance recorded. No payment was made."); await refresh();
    } catch (e) { setMessage(e instanceof Error && e.message === "wrong_payer" ? "Only the named buyer can accept this invoice." : e instanceof Error ? e.message : "Acceptance could not be recorded."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-line p-4 text-sm" aria-label="Buyer acceptance"><h2 className="font-medium">Invoice and delivery acceptance</h2><p className="mt-2">Confirm only if you received the invoice and delivery and have no current dispute. This is advisory financing evidence, not a payment or an irrevocable waiver.</p>{quote && <p className="my-2" data-testid="buyer-financing-quote">{quote.acknowledged ? "Acceptance recorded" : "Not yet accepted"} · Indicative financing discount {(quote.suggestedDiscountBps / 100).toFixed(2)}% · {quote.buyerRecord.onTimeCounterparties} distinct supplier addresses. Addresses are not verified independent people; financing is not guaranteed.</p>}{!quote?.acknowledged && <><label className="my-3 flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have received the invoice and delivery and have no current dispute.</label><div className="flex flex-wrap gap-2"><button type="button" disabled={!confirmed || busy} onClick={() => accept(false)} className="rounded border border-control px-3 py-2 disabled:opacity-50">Accept with my passkey</button>{provider && <button type="button" disabled={!confirmed || busy} onClick={() => accept(true)} className="rounded border border-control px-3 py-2 disabled:opacity-50">Accept with my wallet</button>}</div></>}{message && <p role="status" className="mt-2">{message}</p>}</section>;
}
