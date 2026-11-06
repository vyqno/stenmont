import { LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, USDT_ADDRESS, X402_KEY, fromUnits, parseHttpsUrl, parseLimitsRecord, parseTokenRecord, toUnits, whitechainSepolia } from "@stenmont/shared";
import type { Address } from "viem";
import type { AgentOptions } from "./index";

/**
 * Reads a business's pay directory (ENS text records, see docs/ENS_DIRECTORY.md) and validates it strictly. Every value is
 * untrusted text from the chain: anything missing, malformed or inconsistent is refused, never repaired or guessed.
 */
export type TextReader = (name: string, key: string) => Promise<string | null | undefined>;

export type DirectoryReason =
  | "bad_name" | "lookup_failed" | "missing_pay" | "missing_token" | "missing_limits" | "no_x402"
  | "bad_pay" | "bad_x402" | "bad_token" | "wrong_token" | "bad_limits" | "bad_refund";

export class DirectoryError extends Error {
  constructor(public reason: DirectoryReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "DirectoryError";
  }
}

export type Business = {
  name: string;
  pay: string;
  x402: string | null;
  token: { chainId: number; address: Address };
  limits: { perInvoice: bigint };
  refund: string | null;
};

const NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const REFUND_MAX = 280;

export async function resolveBusiness(rawName: string, read: TextReader): Promise<Business> {
  const name = rawName.trim().toLowerCase();
  if (!NAME.test(name) || name.length > 253) throw new DirectoryError("bad_name", "not an ENS name");
  const get = async (key: string): Promise<string | null> => {
    try {
      const v = await read(name, key);
      return typeof v === "string" && v !== "" ? v : null;
    } catch (e) {
      throw new DirectoryError("lookup_failed", `${key}: ${e instanceof Error ? e.message : "error"}`);
    }
  };
  const [pay, x402, token, limits, refund] = await Promise.all([get(PAY_KEY), get(X402_KEY), get(TOKEN_KEY), get(LIMITS_KEY), get(REFUND_KEY)]);

  if (pay === null) throw new DirectoryError("missing_pay", PAY_KEY);
  if (token === null) throw new DirectoryError("missing_token", TOKEN_KEY);
  if (limits === null) throw new DirectoryError("missing_limits", LIMITS_KEY);

  const payUrl = parseHttpsUrl(pay);
  if (!payUrl) throw new DirectoryError("bad_pay", "must be a plain https address");
  let x402Url: string | null = null;
  if (x402 !== null) {
    x402Url = parseHttpsUrl(x402);
    if (!x402Url) throw new DirectoryError("bad_x402", "must be a plain https address");
  }
  const t = parseTokenRecord(token);
  if (!t) throw new DirectoryError("bad_token", "unreadable token record");
  if (t.chainId !== whitechainSepolia.id || t.address.toLowerCase() !== USDT_ADDRESS.toLowerCase()) throw new DirectoryError("wrong_token", "only the official USDT on Whitechain Testnet is paid");
  const cap = parseLimitsRecord(limits);
  if (!cap) throw new DirectoryError("bad_limits", "unreadable cap");

  let refundText: string | null = null;
  if (refund !== null) {
    const bad = refund.length > REFUND_MAX || /[\u0000-\u001f\u007f]/.test(refund) || /^(javascript|data|vbscript|file|blob|http):/i.test(refund) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(refund) && !parseHttpsUrl(refund));
    if (bad) throw new DirectoryError("bad_refund", "must be short text or an https link");
    refundText = refund;
  }
  return { name, pay: payUrl, x402: x402Url, token: { chainId: t.chainId, address: USDT_ADDRESS }, limits: cap, refund: refundText };
}

/**
 * The agent options for paying this business: only the host its directory names, and never more per request than the
 * business's own published cap, whatever the caller asked for.
 */
export function agentOptionsFor(b: Business, o: { maxPerRequest: string; dailyLimit: string }): Pick<AgentOptions, "maxPerRequest" | "dailyLimit" | "allowedHosts"> {
  if (!b.x402) throw new DirectoryError("no_x402", `${b.name} publishes no x402 endpoint`);
  const asked = toUnits(o.maxPerRequest);
  return { maxPerRequest: fromUnits(asked < b.limits.perInvoice ? asked : b.limits.perInvoice), dailyLimit: o.dailyLimit, allowedHosts: [new URL(b.x402).hostname] };
}
