import type { Address } from "viem";
import { LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, X402_KEY, DIRECTORY_KEYS, limitsRecord, tokenRecord, type DirectoryKey } from "@stenmont/shared";
import { parseSiteUrl } from "../sites/url";

/**
 * The pay directory: the ENS text records that say how to pay a business. Pure: it turns facts we hold into the record set
 * and says what it left out and why. It never touches the chain. See docs/ENS_DIRECTORY.md for the schema.
 *
 * Trust: `token` and `limits` are derived (chain config, verification tier). `pay`, `x402` and `refund` are the business's
 * own words, so a web address is only published when its host belongs to a site the business proved it controls.
 */
export type DirectoryFacts = {
  chainId: number;
  usdt: Address;
  /** Largest single invoice at the business's tier, USDT base units. */
  perInvoice: bigint;
  /** Hosts of this business's sites whose domain check passed. */
  verifiedHosts: string[];
  payUrl: string | null;
  x402Url: string | null;
  refund: string | null;
};
export type Omission = { key: DirectoryKey; reason: "not_https" | "host_not_verified" | "too_long" | "bad_text" | "no_cap" };
export type Directory = { records: Partial<Record<DirectoryKey, string>>; omitted: Omission[] };

const REFUND_MAX = 280;
const covered = (host: string, verified: string[]) => verified.some((v) => host === v || host.endsWith(`.${v}`));
const LOOKS_LIKE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const UNSAFE_SCHEME = /^(javascript|data|vbscript|file|blob):/i;

type Link = { ok: true; url: string } | { ok: false; reason: Omission["reason"] };
function link(raw: string, verified: string[]): Link {
  const p = parseSiteUrl(raw.trim());
  if (!p.ok) return { ok: false, reason: "not_https" };
  return covered(p.host, verified) ? { ok: true, url: p.url } : { ok: false, reason: "host_not_verified" };
}

export function buildDirectory(f: DirectoryFacts): Directory {
  const records: Directory["records"] = { [TOKEN_KEY]: tokenRecord(f.chainId, f.usdt) };
  const omitted: Omission[] = [];
  const skip = (key: DirectoryKey, reason: Omission["reason"]) => omitted.push({ key, reason });

  if (f.perInvoice > 0n) records[LIMITS_KEY] = limitsRecord(f.perInvoice);
  else skip(LIMITS_KEY, "no_cap");

  for (const [key, raw] of [[PAY_KEY, f.payUrl], [X402_KEY, f.x402Url]] as const) {
    if (raw === null) continue;
    const l = link(raw, f.verifiedHosts);
    if (l.ok) records[key] = l.url;
    else skip(key, l.reason);
  }

  if (f.refund !== null) {
    const text = f.refund.trim();
    if (text.length > REFUND_MAX) skip(REFUND_KEY, "too_long");
    else if (!text || /[\u0000-\u001f\u007f]/.test(text) || UNSAFE_SCHEME.test(text) || /^http:\/\//i.test(text)) skip(REFUND_KEY, "bad_text");
    else if (LOOKS_LIKE_URL.test(text)) {
      const l = link(text, f.verifiedHosts);
      if (l.ok) records[REFUND_KEY] = l.url;
      else skip(REFUND_KEY, l.reason === "not_https" ? "bad_text" : l.reason);
    } else records[REFUND_KEY] = text;
  }
  return { records, omitted };
}

/** What to write so ENS ends up equal to `next`: changed values, and "" for a published record no longer wanted. */
export function diffDirectory(prior: Record<string, string>, next: Partial<Record<DirectoryKey, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of DIRECTORY_KEYS) {
    const want = next[k];
    const had = prior[k];
    if (want !== undefined) {
      if (want !== had) out[k] = want;
    } else if (had) out[k] = "";
  }
  return out;
}
