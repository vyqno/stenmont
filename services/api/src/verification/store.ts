import { and, eq, gte, ne } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv, Db } from "../app";
import { invoices, siteChecks, sites, verificationLimits, verificationRecords, worldEnrollments } from "../db/schema";
import { fail } from "../errors";
import { computeTier, howToReach, resolveLimits, type Gate, type Method, type Refusal, type Tier, type TierLimits } from "./tiers";

export const loadLimits = async (db: Db): Promise<Record<number, TierLimits>> => resolveLimits(await db.select().from(verificationLimits));

export async function loadFacts(db: Db, merchantId: string) {
  const records = await db.select().from(verificationRecords).where(eq(verificationRecords.merchantId, merchantId));
  const [domain] = await db
    .select({ siteId: siteChecks.siteId })
    .from(siteChecks)
    .innerJoin(sites, eq(sites.id, siteChecks.siteId))
    .where(and(eq(sites.merchantId, merchantId), eq(siteChecks.kind, "domain"), eq(siteChecks.ok, 1)))
    .limit(1);
  const [world] = await db.select({ id: worldEnrollments.id }).from(worldEnrollments).where(and(eq(worldEnrollments.merchantId, merchantId), eq(worldEnrollments.action, "enrol-business"))).limit(1);
  return { records, domainVerified: !!domain, worldEnrolled: !!world };
}

export async function merchantTier(db: Db, merchantId: string, now: Date): Promise<{ tier: Tier; via: Method | null }> {
  return computeTier(await loadFacts(db, merchantId), now);
}

/** Total of invoices this business created in the last 24 hours (failed ones never existed onchain, so they do not count). */
export async function volumeToday(db: Db, merchantId: string, now: Date): Promise<bigint> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const rows = await db.select({ amount: invoices.amount }).from(invoices).where(and(eq(invoices.merchantId, merchantId), gte(invoices.createdAt, since), ne(invoices.status, "failed")));
  return rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
}

/** Writes a decision. Other sign-in features (email codes, Google Workspace) call this with method "email" or "domain". */
export async function recordVerification(
  db: Db,
  r: { merchantId: string; method: Method; provider?: string; reference?: string; decision: "approved" | "rejected" | "pending"; decidedAt: Date; expiresAt?: Date | null },
): Promise<void> {
  const tier = { email: 1, domain: 2, world: 3, kyc: 4 }[r.method];
  await db.insert(verificationRecords).values({
    id: crypto.randomUUID(),
    merchantId: r.merchantId,
    tier,
    method: r.method,
    provider: r.provider ?? null,
    reference: r.reference ?? null,
    decision: r.decision,
    decidedAt: r.decidedAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  });
}

const MESSAGES: Record<Refusal["reason"], string> = {
  per_invoice: "This invoice is larger than your verification level allows.",
  daily_volume: "This would take you over what your verification level allows in a day.",
  financing_tier: "Selling an invoice needs a higher verification level.",
  financing_cap: "This invoice is larger than the amount your verification level may sell.",
  investor_tier: "Investing needs the highest verification level (identity documents).",
};

/** 403 `tier_limit`: says what was refused, the current tier, the next tier that would allow it, and how to reach it. */
export function tierLimitResponse(c: Context<AppEnv>, gate: Refusal, currentTier: Tier) {
  return fail(c, 403, "tier_limit", `${MESSAGES[gate.reason]} ${gate.nextTier === null ? "No higher level allows it." : `Reach tier ${gate.nextTier}: ${howToReach(gate.nextTier)}`}`, {
    reason: gate.reason,
    currentTier,
    nextTier: gate.nextTier,
    howToReach: howToReach(gate.nextTier),
  });
}

export const refused = (g: Gate): g is Refusal => !g.ok;
