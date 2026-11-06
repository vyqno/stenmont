"use client";

import { useState } from "react";
import { useMerchant } from "../app/dashboard/DashboardShell";
import { refundApprovalPayload, refundApprovalState, type ApprovalParams, type ApprovalReason } from "../lib/refundApproval";
import { AuthError, api, signChallenge } from "../lib/auth";

type Step = "idle" | "working" | "sent" | "failed" | "needs_approval";

/** Refunds what the customer paid: the server works out the amount, the merchant's passkey approves, the refund is sent. */
export function RefundButton({ invoiceId, onDone }: { invoiceId: string; onDone?: () => void }) {
  const merchant = useMerchant();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const [approvalReason, setApprovalReason] = useState<ApprovalReason>("approval_required");
  const [approving, setApproving] = useState(false);
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
      const needs = refundApprovalState(e, invoiceId);
      if (needs) {
        // A large refund: a person has to approve it with World before it can be signed and sent.
        setParams(needs.params);
        setApprovalReason(needs.reason);
        setStep("needs_approval");
        return;
      }
      setStep("failed");
      setMessage(e instanceof AuthError ? e.message : "The refund could not be sent. Try again.");
    }
  }

  async function approve() {
    if (!params) return;
    setApproving(true);
    setMessage("");
    try {
      const a = await api.post<{ authorizeUrl: string }>("/v1/approvals", refundApprovalPayload(params));
      window.location.assign(a.authorizeUrl); // World asks for a fresh sign-in, then sends the person back to the dashboard
    } catch (e) {
      setStep("needs_approval");
      setMessage(e instanceof AuthError ? e.message : "The approval could not be started. Try again.");
    } finally { setApproving(false); }
  }

  if (step === "needs_approval" && params) {
    return <RefundApprovalPrompt params={params} reason={approvalReason} busy={approving} message={message} onApprove={approve} />;
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

/** The retry remains an explicit human action; denied/expired requests are never silently restarted. */
export function RefundApprovalPrompt({ params, reason, busy, message, onApprove }: { params: ApprovalParams; reason: ApprovalReason; busy: boolean; message?: string; onApprove: () => void }) {
  const fresh = reason === "approval_denied" || reason === "approval_expired";
  return <span className="inline-flex max-w-64 flex-col items-end gap-1 text-right text-xs"><span data-testid="needs-approval">{fresh ? `${reason === "approval_denied" ? "The previous approval was denied" : "The previous approval expired"}. Nothing was refunded. Request a fresh approval for the same $${params.amount} refund.` : `This refund is large ($${params.amount}). A person must approve it with World first.`}</span><button type="button" onClick={onApprove} disabled={busy} className="rounded bg-brand px-3 py-1 text-sm font-medium text-on-brand disabled:opacity-50" data-testid="approve-with-world">{busy ? "Starting approval…" : fresh ? "Request fresh World approval" : "Approve with World"}</button>{message && <span role="status" className="text-danger">{message}</span>}</span>;
}
