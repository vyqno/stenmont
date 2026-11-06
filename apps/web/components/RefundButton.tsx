"use client";

import { useState } from "react";
import { useMerchant } from "../app/dashboard/DashboardShell";
import { AuthError, api, signChallenge } from "../lib/auth";

type Step = "idle" | "working" | "sent" | "failed" | "needs_approval";
type ApprovalParams = { invoiceId: string; amount: string; to: string };

/** Refunds what the customer paid: the server works out the amount, the merchant's passkey approves, the refund is sent. */
export function RefundButton({ invoiceId, onDone }: { invoiceId: string; onDone?: () => void }) {
  const merchant = useMerchant();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const [params, setParams] = useState<ApprovalParams | null>(null);

  async function refund() {
    setStep("working");
    setMessage("");
    try {
      const req = await api.post<{ id: string; challenge: string }>("/v1/refunds", { invoiceId });
      const signed = await signChallenge(req.challenge, merchant.credentialId);
      await api.post(`/v1/refunds/${req.id}/submit`, signed);
      setStep("sent");
      onDone?.();
    } catch (e) {
      const needs = e instanceof AuthError && e.code === "approval_required" ? (e.details as { approvalParams?: ApprovalParams } | undefined)?.approvalParams : undefined;
      if (needs) {
        // A large refund: a person has to approve it with World before it can be signed and sent.
        setParams(needs);
        setStep("needs_approval");
        return;
      }
      setStep("failed");
      setMessage(e instanceof AuthError ? e.message : "The refund could not be sent. Try again.");
    }
  }

  async function approve() {
    if (!params) return;
    setStep("working");
    try {
      const a = await api.post<{ authorizeUrl: string }>("/v1/approvals", { operation: "refund", params });
      window.location.assign(a.authorizeUrl); // World asks for a fresh sign-in, then sends the person back to the dashboard
    } catch (e) {
      setStep("failed");
      setMessage(e instanceof AuthError ? e.message : "The approval could not be started. Try again.");
    }
  }

  if (step === "needs_approval" && params) {
    return (
      <span className="inline-flex max-w-64 flex-col items-end gap-1 text-right text-xs">
        <span data-testid="needs-approval">This refund is large (${params.amount}). A person must approve it with World first.</span>
        <button type="button" onClick={approve} className="rounded bg-brand px-3 py-1 text-sm font-medium text-on-brand" data-testid="approve-with-world">Approve with World</button>
      </span>
    );
  }
  if (step === "sent") return <span data-testid="refund-sent" className="text-sm font-medium">Refund sent</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refund}
        disabled={step === "working"}
        className="rounded border border-line px-3 py-1 text-sm hover:border-brand disabled:opacity-50"
      >
        {step === "working" ? "Confirm on your device…" : "Refund"}
      </button>
      {message && (
        <span role="status" data-testid="refund-error" className="max-w-56 text-right text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}
