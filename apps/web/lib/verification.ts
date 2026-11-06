import { whitechainSepolia } from "@stenmont/shared";
import { createSiweMessage } from "viem/siwe";

export type Limit = { tier: number; perInvoice: string; dailyVolume: string; financing: boolean; financingCap: string; investor: boolean };
export type RecordView = { method: string; decision: string; decidedAt: string; expiresAt: string | null };
export type NextStep = { tier: number; route: "email" | "domain" | "world" | "documents"; howTo: string };
export type VerificationStatus = {
  tier: number;
  via: string | null;
  nextStep: NextStep | null;
  usedToday: string;
  limits: Limit[];
  facts: { worldEnrolled: boolean; domainVerified: boolean };
  records: RecordView[];
  badge: { name: string; publishedTier: number | null; publishedAt: string | null } | null;
  kyc: { available: boolean; provider: string | null; sandbox: boolean };
};

/** The ladder in plain words. The numbers come from the server; these are only the names and how to climb. */
export const TIERS = [
  { tier: 0, name: "Just started", how: "You have an account." },
  { tier: 1, name: "Email confirmed", how: "Confirm your email address with a code." },
  { tier: 2, name: "Website confirmed", how: "Show that you control your website." },
  { tier: 3, name: "Real person confirmed", how: "Show that one real person runs this business, without sharing documents." },
  { tier: 4, name: "Documents checked", how: "Pass an identity and business check with our verification partner." },
] as const;

export function formatUsd(v: string): string {
  const n = Number(v);
  const [whole = "0", frac] = v.split(".");
  const grouped = Number.isFinite(n) ? Number(whole).toLocaleString("en-US") : whole;
  return `$${grouped}${frac && Number(`0.${frac}`) > 0 ? `.${frac.padEnd(2, "0").slice(0, 2)}` : ""}`;
}

export function unlocks(l: Limit): string[] {
  const out = [`Invoices up to ${formatUsd(l.perInvoice)} each`, `Up to ${formatUsd(l.dailyVolume)} of invoices a day`];
  if (l.financing) out.push(`Sell unpaid invoices up to ${formatUsd(l.financingCap)} for cash now`);
  if (l.investor) out.push("Fund other businesses' invoices as an investor");
  return out;
}

export type LadderRow = { tier: number; name: string; how: string; state: "reached" | "current" | "next" | "later"; unlocks: string[] };
export function ladder(s: VerificationStatus): LadderRow[] {
  return TIERS.map((t) => ({
    ...t,
    state: t.tier < s.tier ? "reached" : t.tier === s.tier ? "current" : t.tier === s.tier + 1 ? "next" : "later",
    unlocks: unlocks(s.limits.find((l) => l.tier === t.tier) ?? s.limits[0]!),
  }));
}

export type RouteCard = { route: NextStep["route"]; tier: number; title: string; plain: string; state: "done" | "open" | "pending" | "unavailable" };
const live = (r: RecordView, now: number) => r.decision === "approved" && (r.expiresAt === null || Date.parse(r.expiresAt) > now);
const has = (s: VerificationStatus, method: string, now: number) => s.records.some((r) => r.method === method && live(r, now));

/** The four ways up, each with where it stands. The private route (World) reaches tier 3 and shares no documents. */
export function routeCards(s: VerificationStatus, now = Date.now()): RouteCard[] {
  const kycPending = s.records.some((r) => r.method === "kyc" && r.decision === "pending");
  return [
    { route: "email", tier: 1, title: "Confirm your email", plain: "We send a code to your email address. Unlocks higher limits and email receipts.", state: has(s, "email", now) ? "done" : "open" },
    { route: "domain", tier: 2, title: "Confirm your website", plain: "Add one line to your website's settings to show it is yours. Customers then see a verified business badge.", state: s.facts.domainVerified || has(s, "domain", now) ? "done" : "open" },
    { route: "world", tier: 3, title: "Confirm you are a real person, privately", plain: "Uses World ID. It proves one real person runs this business, with no documents shared with us. Needed to sell unpaid invoices.", state: s.facts.worldEnrolled || has(s, "world", now) ? "done" : "open" },
    { route: "documents", tier: 4, title: "Check your documents", plain: "A short identity and business check with our verification partner. We keep only the result, never your documents. Needed for the highest limits and for investing.", state: has(s, "kyc", now) ? "done" : kycPending ? "pending" : s.kyc.available ? "open" : "unavailable" },
  ];
}

// ---- wallet sign-in --------------------------------------------------------------------------------------------------------

export const SIWE_MINUTES = 10;
export function buildWalletMessage(a: { address: string; nonce: string; host: string; origin: string; chainId?: number; now?: Date; statement?: string }): string {
  const now = a.now ?? new Date();
  return createSiweMessage({
    address: a.address as `0x${string}`,
    chainId: a.chainId ?? whitechainSepolia.id,
    domain: a.host,
    uri: a.origin,
    nonce: a.nonce,
    version: "1",
    statement: a.statement ?? "Link this wallet to your Stenmont business.",
    issuedAt: now,
    expirationTime: new Date(now.getTime() + SIWE_MINUTES * 60_000),
  });
}

export function walletErrorText(e: { code?: string; reason?: string; name?: string }): string {
  if (e.code === "4001" || e.code === "ACTION_REJECTED" || e.name === "UserRejectedRequestError") return "That was cancelled. Try again when you're ready.";
  switch (e.code) {
    case "wallet_taken": return "That wallet is already linked to another business.";
    case "too_many_wallets": return "You have reached the limit of linked wallets. Remove one first.";
    case "bad_signature": return "The signature did not match that wallet. Try again.";
    case "nonce_invalid": return "That request timed out or was already used. Try again.";
    case "siwe_invalid": return e.reason === "expired" ? "That took too long. Try again." : "The sign-in message was not accepted. Refresh and try again.";
    case "unauthorized": return "Sign in with your passkey first.";
    case "wallet_not_linked": return "This wallet is not linked to a business yet.";
    default: return "The wallet could not be linked right now. Try again.";
  }
}
