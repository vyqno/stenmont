"use client";
import { useState } from "react";
import type { Hex } from "viem";
import { useMerchant } from "../app/dashboard/DashboardShell";
import { trustedInvoiceRouter } from "../lib/v2Payment";
import { api } from "../lib/auth";
import { challengeDeadline, creatorDelegationDigest, signContractDigest, type CreatorDelegation } from "../lib/v2Invoice";

/** Existing merchant accounts must approve the new router's own signature domain. V1 remains separate. */
export function RouterDelegation() {
  const merchant = useMerchant();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function authorize() {
    setBusy(true); setMessage("");
    try {
      const challenge = await api.get<CreatorDelegation & { contractVersion: string; digest: Hex }>("/v1/router-delegation?contractVersion=v2");
      trustedInvoiceRouter({ contractVersion: challenge.contractVersion, routerAddress: challenge.routerAddress }, location.hostname);
      if (challenge.contractVersion !== "v2" || challenge.merchant.toLowerCase() !== merchant.account.toLowerCase() || BigInt(challenge.deadline) <= BigInt(Math.floor(Date.now() / 1000)) || creatorDelegationDigest(challenge) !== challenge.digest) throw new Error("The authorization details could not be verified.");
      const signature = await signContractDigest(challenge.digest, merchant.credentialId);
      await api.post("/v1/router-delegation", { contractVersion: "v2", deadline: challengeDeadline(challenge.deadline), signature });
      setMessage("Router v2 authorized for this business. Existing v1 invoices keep their original router.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Authorization could not be completed."); }
    finally { setBusy(false); }
  }
  return <div className="rounded-xl border border-line p-4 text-sm"><p className="font-medium">Authorize new invoice creation</p><p className="my-2 text-muted">An existing business needs a fresh passkey approval for router v2. This does not move funds or change existing invoices.</p><button type="button" disabled={busy} onClick={authorize} className="rounded border border-control px-3 py-2 disabled:opacity-50">{busy ? "Confirm on your device…" : "Authorize router v2"}</button>{message && <p role="status" className="mt-2">{message}</p>}</div>;
}
