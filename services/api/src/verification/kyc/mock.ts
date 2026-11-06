import type { Env } from "../../env";
import { randomHex } from "../../lib/crypto";
import { verifyWebhookSignature } from "../../lib/signature";
import type { KycDecision, KycProvider, ProviderEvent } from "./provider";

/** How long an approval from the sandbox stays valid. A real provider sends its own expiry or the platform sets a re-check period. */
export const MOCK_APPROVAL_DAYS = 365;

/**
 * SANDBOX PROVIDER. It never looks at a person or a document. Its "check" is completed by a signed webhook (or, outside
 * production, by `POST /v1/verification/kyc/sandbox-decision`), so the whole path (start, signature, replay protection,
 * tier change, audit) is exercised exactly as it will be with a real provider. It is off in production and without its secret.
 *
 * Webhook body: { id, type: "check.completed", reference, result: "green" | "red" | "review", occurredAt }
 * Header:       x-kyc-signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>"> (same scheme as our own webhooks)
 */
export function mockProvider(env: Env): KycProvider | null {
  const secret = env.KYC_MOCK_WEBHOOK_SECRET;
  if (!secret || env.ENVIRONMENT === "production") return null;
  return {
    name: "mock",
    sandbox: true,
    async startCheck({ appUrl }) {
      const reference = `mock_${randomHex(12)}`;
      return { reference, url: `${appUrl}/dashboard/verification?check=${reference}` };
    },
    async parseWebhook(rawBody, headers, now) {
      const ok = await verifyWebhookSignature(secret, rawBody, headers.get("x-kyc-signature") ?? "", { now: Math.floor(now.getTime() / 1000) });
      if (!ok) return { ok: false, reason: "bad_signature" };
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "bad_body" };
      }
      const b = body as Record<string, unknown>;
      if (typeof b?.id !== "string" || typeof b.reference !== "string" || b.type !== "check.completed" || typeof b.result !== "string") return { ok: false, reason: "bad_body" };
      return { ok: true, event: { id: b.id, reference: b.reference, raw: b } };
    },
    mapDecision(event: ProviderEvent): KycDecision | null {
      const b = event.raw as { result: string; occurredAt?: unknown };
      const t = typeof b.occurredAt === "string" ? Date.parse(b.occurredAt) : NaN;
      if (Number.isNaN(t)) return null;
      const occurredAt = new Date(t);
      const decision = b.result === "green" ? "approved" : b.result === "red" ? "rejected" : "pending";
      return { eventId: event.id, reference: event.reference, decision, occurredAt, expiresAt: decision === "approved" ? new Date(t + MOCK_APPROVAL_DAYS * 86_400_000) : null };
    },
  };
}
