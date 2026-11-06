import type { Env } from "../../env";
import { mockProvider } from "./mock";

/**
 * Identity and business verification (KYC/KYB) by a licensed provider.
 *
 * NOT INTEGRATED WITH A REAL PROVIDER. Only the sandbox provider in `mock.ts` exists. A real one (Sumsub, Persona, Veriff or
 * similar) needs the founder's account with that provider and a cost decision; add it by implementing this interface in a
 * new file and listing it in `kycProvider` below. Nothing else changes.
 *
 * What we keep: the provider's reference for a check, and its decision (approved, rejected, pending), with a time and an
 * expiry. We never receive, store or log identity documents or personal details: the provider holds them.
 */
export type Decision = "approved" | "rejected" | "pending";

/** A webhook after its signature was checked. The shape is the provider's own; `mapDecision` turns it into ours. */
export type ProviderEvent = { id: string; reference: string; raw: unknown };

export type KycDecision = { eventId: string; reference: string; decision: Decision; occurredAt: Date; expiresAt: Date | null };

export interface KycProvider {
  readonly name: string;
  /** True for providers that never verify a real person (the mock). The API says so in its responses. */
  readonly sandbox: boolean;
  /** Opens a check at the provider and returns where the person goes to complete it. */
  startCheck(input: { merchantId: string; appUrl: string; now: Date }): Promise<{ reference: string; url: string }>;
  /** Verifies the webhook's signature and freshness BEFORE trusting any of the body. */
  parseWebhook(rawBody: string, headers: Headers, now: Date): Promise<{ ok: true; event: ProviderEvent } | { ok: false; reason: "bad_signature" | "bad_body" }>;
  mapDecision(event: ProviderEvent): KycDecision | null;
}

/** The provider for a name, or null when it does not exist or is not available in this environment. */
export function kycProvider(name: string, env: Env): KycProvider | null {
  if (name === "mock") return mockProvider(env);
  return null;
}

/** The provider used to start a new check. */
export const defaultProvider = (env: Env): KycProvider | null => kycProvider("mock", env);
