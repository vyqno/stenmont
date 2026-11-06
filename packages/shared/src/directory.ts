import type { Address } from "viem";
import { USDT_ADDRESS, whitechainSepolia } from "./chains";
import { fromUnits, toUnits } from "./money";

/**
 * The ENS pay directory: text records on a business's name that tell a payer, or an AI agent, how to pay it. Every one is
 * written by the platform's registrar and never granted to the business, a team member or an agent (see ens.ts
 * `BUSINESS_GRANTED_KEYS`). Readers must treat each value as untrusted and validate it with the parsers below.
 */
export const PAY_KEY = "stenmont.pay";
export const X402_KEY = "stenmont.x402";
export const TOKEN_KEY = "stenmont.token";
export const REFUND_KEY = "stenmont.refund";
export const LIMITS_KEY = "stenmont.limits";
export const DIRECTORY_KEYS = [PAY_KEY, X402_KEY, TOKEN_KEY, REFUND_KEY, LIMITS_KEY, "stenmont.collections"] as const;
export type DirectoryKey = (typeof DIRECTORY_KEYS)[number];

/** The accepted token, as `eip155:<chain>/erc20:<address>`. Always derived from our chain config, never typed by a person. */
export const tokenRecord = (chainId: number = whitechainSepolia.id, address: Address = USDT_ADDRESS): string => `eip155:${chainId}/erc20:${address}`;

export function parseTokenRecord(v: string): { chainId: number; address: Address } | null {
  const m = /^eip155:(\d{1,9})\/erc20:(0x[0-9a-fA-F]{40})$/.exec(v);
  return m ? { chainId: Number(m[1]), address: m[2] as Address } : null;
}

/** No single invoice above this is believable for the demo ladder, so a reader treats a larger cap as corrupt. */
const MAX_CAP = toUnits("1000000000");

export const limitsRecord = (perInvoice: bigint): string => JSON.stringify({ perInvoice: fromUnits(perInvoice), unit: "USDT" });

export function parseLimitsRecord(v: string): { perInvoice: bigint } | null {
  let j: unknown;
  try {
    j = JSON.parse(v);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== "perInvoice,unit" || o.unit !== "USDT" || typeof o.perInvoice !== "string") return null;
  try {
    const n = toUnits(o.perInvoice);
    return n > 0n && n <= MAX_CAP ? { perInvoice: n } : null;
  } catch {
    return null;
  }
}

const PRIVATE_SUFFIXES = ["localhost", "local", "internal", "localdomain", "lan", "home", "home.arpa", "corp", "intranet"];

/**
 * A strict https address: standard port, no credentials, a public-looking name (not an IP literal, not a private suffix),
 * no whitespace. Returns the address without a trailing slash, or null. Reading a name never fetches anything by itself.
 */
export function parseHttpsUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (host.startsWith("[") || labels.length < 2 || !labels.every((l) => /^[a-z0-9-]{1,63}$/.test(l)) || /^\d+$/.test(labels[labels.length - 1]!)) return null;
  if (PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  return `https://${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}
