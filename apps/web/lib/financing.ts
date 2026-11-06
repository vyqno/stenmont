import { CLAIM_LIMITS, fromUnits, quoteClaim, toUnits } from "@stenmont/shared";
import type { Hex } from "viem";
import { b64urlDecode } from "./pay";

export const MAX_DISCOUNT_PCT = CLAIM_LIMITS.maxDiscountBps / 100;
export const MAX_RESERVE_PCT = CLAIM_LIMITS.maxReserveBps / 100;

/** "3" or "2.5" -> basis points (300, 250). Null when it is not a number with at most two decimals, or is outside [min, max] percent. */
export function pctToBps(input: string, min: number, max: number): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(input.trim())) return null;
  const bps = Math.round(Number(input) * 100);
  return bps >= min * 100 && bps <= max * 100 ? bps : null;
}

export type SaleQuote = { price: string; reserve: string; advance: string };

/** What the merchant sees before signing; the same rounding (down) as the API and the contract. Null if the inputs are not allowed. */
export function quoteSale(face: string, discountPct: string, reservePct: string): SaleQuote | null {
  const d = pctToBps(discountPct, 1 / 100, MAX_DISCOUNT_PCT);
  const r = pctToBps(reservePct, 0, MAX_RESERVE_PCT);
  if (d === null || r === null) return null;
  const { price, reserve } = quoteClaim(toUnits(face), d, r);
  if (price === 0n) return null;
  return { price: fromUnits(price), reserve: fromUnits(reserve), advance: fromUnits(price - reserve) };
}

/** The base64url digest the server hands back -> the 0x hex digest the passkey helper signs. */
export function b64urlToHex(s: string): Hex {
  return `0x${[...b64urlDecode(s)].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** "3.09" -> "3.09%". The server sends two decimals already. */
export const formatYield = (pct: string) => `${pct}%`;

export type Reputation = { score: number; paid: number } | null;
export const describeReputation = (r: Reputation) => (r ? `Reliability ${r.score}, ${r.paid} invoice${r.paid === 1 ? "" : "s"} paid` : "No payment history yet");

export type ListingStatus = "listed" | "funding" | "funded" | "settled" | "defaulted" | "cancelled" | string;
/** Row badge on the merchant's invoice list. */
export function listingBadge(status: ListingStatus): { label: string; tone: "ok" | "wait" | "warn" | "bad" | "off" } | null {
  switch (status) {
    case "listed": return { label: "Listed", tone: "wait" };
    case "funding":
    case "funded": return { label: "Funded", tone: "ok" };
    case "settled": return { label: "Settled", tone: "ok" };
    case "defaulted": return { label: "Defaulted", tone: "bad" };
    default: return null;
  }
}

const MESSAGES: Record<string, string> = {
  not_verified: "Verify your business first (Settings, Verify your business).",
  invoice_not_sellable: "This invoice can't be sold. It must be open, unpaid, and due at least an hour from now.",
  already_listed: "This invoice has already been offered to investors.",
  expired: "That took too long. Start again.",
  cancelled: "That was cancelled. Try again when you're ready.",
  bad_signature: "The confirmation could not be checked. Try again.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  duplicate: "This person has already verified an investor account.",
  account_taken: "This account was verified by someone else.",
  blocked: "This account can't be approved to invest.",
  not_allowed: "Verify you are a real person before investing.",
  already_funded: "Someone else already bought this invoice.",
  not_available: "This invoice is no longer for sale.",
  seller_unavailable: "The seller can't complete sales right now. Try again later.",
  busy: "We're a little busy. Please try again in a moment.",
  world_unavailable: "Identity verification isn't available right now.",
  world_error: "Verification could not be completed right now. Try again.",
  timeout: "The purchase is taking longer than expected. Check your portfolio in a minute.",
  insufficient: "You don't have enough funds for this purchase.",
  faucet_limit: "Test funds were already added today.",
};
export const financingMessage = (code: string, fallback = "Something went wrong. Please try again.") => MESSAGES[code] ?? fallback;

export const explorerTx = (hash: string) => `https://explorer.testnet.whitechain.io/tx/${hash}`;
