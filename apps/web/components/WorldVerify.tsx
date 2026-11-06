"use client";

import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useCallback, useEffect, useState } from "react";
import { AuthError, api } from "../lib/auth";
import { Badge, Card, primaryButton } from "./ui";

const ACTION = "enrol-business";
type Setup = { app_id: string; environment: "staging" | "production"; rp_context: RpContext };

/**
 * "One person, one business." The business proves a real, unique person stands behind it. Proof of Human is the minimum
 * that answers the question: a passport or selfie check would prove more than we need and ask more of the person.
 */
export function WorldVerify() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    api.get<{ enrolled: boolean }>("/v1/world/status").then((s) => setEnrolled(s.enrolled), () => setEnrolled(null));
  }, []);
  useEffect(load, [load]);

  async function start() {
    setMessage("");
    try {
      setSetup(await api.post<Setup>("/v1/world/rp-signature", { action: ACTION }));
      setOpen(true);
    } catch (e) {
      setMessage(e instanceof AuthError ? e.message : "Verification could not be started. Try again.");
    }
  }

  return (
    <Card title="Verify your business">
      <p className="text-sm text-muted">Show that one real person stands behind this business. It stops one person running many fake businesses to invent invoices, and it is required before invoices can be sold to investors.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {enrolled === true && <Badge tone="ok">Verified</Badge>}
        {enrolled === false && (
          <button type="button" onClick={start} className={`rounded px-4 py-2 text-sm font-medium ${primaryButton}`} data-testid="world-start">
            Verify with World ID
          </button>
        )}
        {message && (
          <span role="status" data-testid="world-message" className="text-sm text-danger">
            {message}
          </span>
        )}
      </div>
      {setup && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o && enrolled !== true) setMessage((m) => m || "Verification was cancelled. Your business is not verified yet.");
          }}
          app_id={setup.app_id as `app_${string}`}
          action={ACTION}
          rp_context={setup.rp_context}
          environment={setup.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman()}
          handleVerify={async (result: IDKitResult) => {
            try {
              await api.post("/v1/world/verify", { action: ACTION, idkitResponse: result });
            } catch (e) {
              setMessage(e instanceof AuthError ? e.message : "Verification failed. Try again.");
              throw e;
            }
          }}
          onSuccess={() => {
            setMessage("");
            setEnrolled(true);
          }}
        />
      )}
    </Card>
  );
}
