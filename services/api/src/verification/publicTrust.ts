import { eq } from "drizzle-orm";
import type { Db } from "../app";
import { ensNames } from "../db/schema";
import { loadFacts } from "./store";
import { computeTier } from "./tiers";

/**
 * What a payer may be told about a business before paying: which proofs currently hold, its public ENS name and its tier.
 * Booleans, a public name and a small number; nothing a person could be identified or contacted by.
 */
export type PublicTrust = { domain: boolean; world: boolean; ensName: string | null; tier: number };

export async function publicTrust(db: Db, merchantId: string, now: Date): Promise<PublicTrust> {
  const facts = await loadFacts(db, merchantId);
  // Each proof is asked on its own, so a live record counts and an expired one does not, by the same rule that sets the tier.
  const holds = (method: "domain" | "world", extra: Partial<typeof facts>) => computeTier({ records: facts.records.filter((r) => r.method === method), domainVerified: false, worldEnrolled: false, ...extra }, now).tier > 0;
  const [name] = await db.select({ name: ensNames.name, status: ensNames.status }).from(ensNames).where(eq(ensNames.merchantId, merchantId));
  return {
    domain: holds("domain", { domainVerified: facts.domainVerified }),
    world: holds("world", { worldEnrolled: facts.worldEnrolled }),
    ensName: name?.status === "active" ? name.name : null,
    tier: computeTier(facts, now).tier,
  };
}
