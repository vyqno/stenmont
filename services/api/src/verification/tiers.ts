import { toUnits } from "@stenmont/shared";

/**
 * Trust tiers, computed from facts we already hold. Pure: no database, no clock (the caller passes `now`).
 *
 *   0  passkey only            1  verified email        2  verified domain
 *   3  World Proof of Human    4  documents (KYC/KYB) by a provider
 *
 * The tier is the HIGHEST route that currently holds, not a chain: the private route (World) reaches 3 without an email
 * and without handing us any document. Records expire, and a tier computed again after the expiry is lower.
 */
export type Tier = 0 | 1 | 2 | 3 | 4;
export type Method = "email" | "domain" | "world" | "kyc";

/** The tier each method grants. A stored record's own `tier` column is informational: it cannot claim more than its method. */
const METHOD_TIER: Record<Method, Tier> = { email: 1, domain: 2, world: 3, kyc: 4 };

export type VerificationFact = { tier: number; method: string; decision: string; decidedAt: string; expiresAt: string | null };
export type Facts = {
  records: VerificationFact[];
  /** A site of this business has a passing `domain` check (DNS TXT), or a Google Workspace domain was proven. */
  domainVerified: boolean;
  /** A World Proof of Human enrolment row exists. */
  worldEnrolled: boolean;
};

const live = (r: VerificationFact, now: Date) => r.decision === "approved" && (r.expiresAt === null || Date.parse(r.expiresAt) > now.getTime());

export function computeTier(facts: Facts, now: Date): { tier: Tier; via: Method | null } {
  const held = new Set<Method>();
  for (const r of facts.records) if (r.method in METHOD_TIER && live(r, now)) held.add(r.method as Method);
  if (facts.domainVerified) held.add("domain");
  if (facts.worldEnrolled) held.add("world");
  let best: { tier: Tier; via: Method | null } = { tier: 0, via: null };
  for (const m of held) if (METHOD_TIER[m] > best.tier) best = { tier: METHOD_TIER[m], via: m };
  return best;
}

// ---- limits ----------------------------------------------------------------------------------------------------------

export type TierLimits = {
  /** Largest single invoice, USDT base units. */
  perInvoice: bigint;
  /** Total of invoices created in any rolling 24 hours, USDT base units. */
  dailyVolume: bigint;
  /** Largest invoice that may be sold for financing; 0 means selling is not allowed at this tier. */
  financingCap: bigint;
  /** May be allowlisted as an investor. */
  investor: boolean;
};

const U = (n: number) => toUnits(String(n));

/**
 * DEMO DEFAULTS. These numbers exist to make the ladder visible in a demo; they are not a risk decision. A real launch
 * sets its own in the `verification_limits` table (one row per tier overrides the row here) after a compliance review.
 */
export const DEMO_LIMITS: Record<number, TierLimits> = {
  0: { perInvoice: U(100), dailyVolume: U(500), financingCap: 0n, investor: false },
  1: { perInvoice: U(500), dailyVolume: U(2_000), financingCap: 0n, investor: false },
  2: { perInvoice: U(2_000), dailyVolume: U(10_000), financingCap: 0n, investor: false },
  3: { perInvoice: U(10_000), dailyVolume: U(50_000), financingCap: U(5_000), investor: false },
  4: { perInvoice: U(1_000_000), dailyVolume: U(5_000_000), financingCap: U(1_000_000), investor: true },
};

export type LimitRow = { tier: number; perInvoice: string; dailyVolume: string; financingCap: string; investor: number };

/** Stored rows replace the default for their tier. A malformed row is ignored: a bad config must never open a gate. */
export function resolveLimits(rows: LimitRow[]): Record<number, TierLimits> {
  const out: Record<number, TierLimits> = { ...DEMO_LIMITS };
  for (const r of rows) {
    if (!Number.isInteger(r.tier) || r.tier < 0 || r.tier > 4) continue;
    if (![r.perInvoice, r.dailyVolume, r.financingCap].every((v) => /^\d+$/.test(v))) continue;
    out[r.tier] = { perInvoice: BigInt(r.perInvoice), dailyVolume: BigInt(r.dailyVolume), financingCap: BigInt(r.financingCap), investor: r.investor === 1 };
  }
  return out;
}

// ---- gates ------------------------------------------------------------------------------------------------------------

export type Refusal = { ok: false; reason: "per_invoice" | "daily_volume" | "financing_tier" | "financing_cap" | "investor_tier"; nextTier: Tier | null };
export type Gate = { ok: true } | Refusal;

const TIERS: Tier[] = [0, 1, 2, 3, 4];
/** The lowest tier above `tier` whose limits satisfy `fits`, or null when none does. */
const lowestAbove = (tier: number, fits: (t: number) => boolean): Tier | null => TIERS.find((t) => t > tier && fits(t)) ?? null;

export function checkInvoice(limits: Record<number, TierLimits>, tier: number, amount: bigint, usedToday: bigint): Gate {
  const l = limits[tier]!;
  if (amount > l.perInvoice) return { ok: false, reason: "per_invoice", nextTier: lowestAbove(tier, (t) => amount <= limits[t]!.perInvoice) };
  if (usedToday + amount > l.dailyVolume) return { ok: false, reason: "daily_volume", nextTier: lowestAbove(tier, (t) => usedToday + amount <= limits[t]!.dailyVolume) };
  return { ok: true };
}

/** Selling an invoice needs a tier that allows financing at all (3 or higher in the demo defaults) and a face value within its cap. */
export function checkFinancing(limits: Record<number, TierLimits>, tier: number, face: bigint): Gate {
  const l = limits[tier]!;
  if (l.financingCap === 0n) return { ok: false, reason: "financing_tier", nextTier: lowestAbove(tier, (t) => limits[t]!.financingCap > 0n && face <= limits[t]!.financingCap) };
  if (face > l.financingCap) return { ok: false, reason: "financing_cap", nextTier: lowestAbove(tier, (t) => face <= limits[t]!.financingCap) };
  return { ok: true };
}

export function checkInvestor(limits: Record<number, TierLimits>, tier: number): Gate {
  return limits[tier]!.investor ? { ok: true } : { ok: false, reason: "investor_tier", nextTier: lowestAbove(tier, (t) => limits[t]!.investor) };
}

// ---- what to do next --------------------------------------------------------------------------------------------------

export type Route = "email" | "domain" | "world" | "documents";
const STEPS: Record<number, { tier: Tier; route: Route; howTo: string }> = {
  0: { tier: 1, route: "email", howTo: "Confirm your email address with the code we send you." },
  1: { tier: 2, route: "domain", howTo: "Prove you control your website: add the TXT record shown under Connect, then run the domain check." },
  2: { tier: 3, route: "world", howTo: "Verify with World ID in Settings. It proves one real person runs this business and shares no documents with us." },
  3: { tier: 4, route: "documents", howTo: "Complete the identity and business check with our verification partner, from the Verification page." },
};
export const nextStepFor = (tier: number) => STEPS[tier] ?? null;

/** How to reach a given tier from the current one, in plain words (used in error messages). */
export const howToReach = (target: Tier | null): string => (target === null ? "No higher tier is available." : (Object.values(STEPS).find((s) => s.tier === target)?.howTo ?? ""));
