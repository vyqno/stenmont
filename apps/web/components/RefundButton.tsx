"use client";

import { useState } from "react";
import { useMerchant } from "../app/dashboard/DashboardShell";
import { AuthError, api, signChallenge } from "../lib/auth";

type Step = "idle" | "working" | "sent" | "failed";

/** Refunds what the customer paid: the server works out the amount, the merchant's passkey approves, the refund is sent. */
export function RefundButton({ invoiceId, onDone }: { invoiceId: string; onDone?: () => void }) {
  const merchant = useMerchant();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");

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
      setStep("failed");
      setMessage(e instanceof AuthError ? e.message : "The refund could not be sent. Try again.");
    }
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
