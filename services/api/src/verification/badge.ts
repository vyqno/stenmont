import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "../app";
import { audit } from "../audit";
import { ensNames, merchants, tierBadges } from "../db/schema";
import type { EnsClient } from "../ens/client";
import { merchantTier } from "./store";

/**
 * The tier badge: the business's tier published as the ENS text record `stenmont.tier`, so a payer or an agent can read it
 * from ENS before paying. Only the platform's registrar can write it (see `setTierRecord`): the business cannot forge it.
 */
type Deps = { db: Db; ens: EnsClient; now: Date };
export type BadgeResult = { status: "published" | "unchanged" | "no_name" | "failed"; tier: number; name?: string; txHash?: string };

export async function publishTierBadge({ db, ens, now }: Deps, merchantId: string): Promise<BadgeResult> {
  const [row] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchantId));
  if (!row || row.status !== "active") return { status: "no_name", tier: (await merchantTier(db, merchantId, now)).tier };
  const { tier } = await merchantTier(db, merchantId, now);
  const [prior] = await db.select().from(tierBadges).where(eq(tierBadges.merchantId, merchantId));
  // No record means "tier 0", so a business that never left tier 0 costs no transaction.
  if ((prior?.publishedTier ?? 0) === tier) return { status: "unchanged", tier, name: row.name };
  try {
    const txHash = await ens.setTierRecord({ name: row.name, resolver: row.resolver as Address, tier });
    const badge = { merchantId, publishedTier: tier, txHash, publishedAt: now.toISOString() };
    await db.insert(tierBadges).values(badge).onConflictDoUpdate({ target: tierBadges.merchantId, set: badge });
    await audit(db, { merchantId, actor: "system", action: "verification.badge_published", payload: { name: row.name, tier, txHash } });
    return { status: "published", tier, name: row.name, txHash };
  } catch (e) {
    console.error("tier badge failed", e);
    // For example a name whose payout was locked before the badge existed: its registrar can no longer write the record.
    await audit(db, { merchantId, actor: "system", action: "verification.badge_failed", payload: { name: row.name, tier } });
    return { status: "failed", tier, name: row.name };
  }
}

/** Hourly: publishes every active business whose tier differs from what ENS shows, including downgrades after an expiry. */
// ponytail: walks all names in creation order and stops after `limit` attempts; with thousands of names, page by last attempt instead.
export async function runTierBadges(deps: Deps, limit = 20): Promise<{ published: number; failed: number }> {
  const rows = await deps.db
    .select({ id: ensNames.merchantId })
    .from(ensNames)
    .innerJoin(merchants, eq(merchants.id, ensNames.merchantId))
    .where(and(eq(ensNames.status, "active"), eq(merchants.status, "active")))
    .orderBy(ensNames.createdAt);
  let published = 0;
  let failed = 0;
  for (const { id } of rows) {
    if (published + failed >= limit) break;
    const r = await publishTierBadge(deps, id);
    if (r.status === "published") published++;
    if (r.status === "failed") failed++;
  }
  return { published, failed };
}
