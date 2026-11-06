import type { Context } from "hono";
import type { AppEnv } from "../app";
import type { Identity } from "./sessions";
import { recordVerification } from "../verification/store";
/** Connect verified sign-in facts to the integrated tier store, without linking by matching email. */
export async function recordIdentityFacts(c: Context<AppEnv>, identity: Identity) {
  if (!identity.merchant_id) return;
  const insert = async (method: "email" | "domain", provider: string, reference: string, expiresAt?: Date) => {
    const exists = () => c.env.DB.prepare("SELECT id FROM verification_records WHERE provider=? AND reference=?").bind(provider, reference).first();
    if (await exists()) return;
    try { await recordVerification(c.var.db, { merchantId: identity.merchant_id!, method, provider, reference, decision: "approved", decidedAt: c.var.now(), expiresAt }); }
    catch (e) { if (!await exists()) throw e; } // Concurrent idempotent linking may have inserted this fact first.
  };
  await insert("email", `identity-${identity.provider}`, identity.id);
  if (identity.provider !== "google") return;
  const domain = await c.env.DB.prepare("SELECT domain,verified_at FROM identity_google_domains WHERE identity_id=?").bind(identity.id).first<{domain:string;verified_at:string}>();
  if (domain) await insert("domain", "google-workspace", `${identity.id}:${domain.verified_at}`, new Date(Date.parse(domain.verified_at) + 86400_000));
}
