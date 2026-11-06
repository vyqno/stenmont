import { BridgeError } from "./util";

const SCALE = 1_000_000n; // 6 decimals, like USDT
const DECIMAL = /^\d{1,15}(\.\d{1,6})?$/;
const MAX_UNITS = 10n ** 15n; // one billion USDT: far above any real order, far below anything that could overflow a later step

/** "12.5" -> 12_500_000n. Rejects anything that is not a plain non-negative decimal with at most 6 places. */
export function parseUnits6(s: string): bigint | null {
  if (!DECIMAL.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * SCALE + BigInt(frac.padEnd(6, "0"));
}

export function formatUnits6(u: bigint): string {
  const frac = (u % SCALE).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${u / SCALE}.${frac}`;
}

/**
 * Converts a Shopify total into the USDT amount of a Stenmont invoice (a decimal string with at most 6 places), rounding half up.
 * USD is taken as 1 USDT. Any other currency needs `ratePerUsd` (units of that currency for 1 USD), which the owner sets:
 * a rate is never invented and never fetched.
 */
export function toUsdtAmount(amount: string, currency: string, ratePerUsd?: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) throw new BridgeError(422, "bad_currency", "The shop currency is not a three-letter code.");
  const a = parseUnits6(amount);
  if (a === null) throw new BridgeError(422, "bad_amount", "The total from Shopify is not a valid amount.");
  if (a <= 0n) throw new BridgeError(422, "bad_amount", "The total must be greater than zero.");
  let r = SCALE;
  if (currency !== "USD") {
    const given = ratePerUsd?.trim();
    if (!given) throw new BridgeError(422, "needs_rate", `The shop currency is ${currency}. Set RATE_PER_USD (${currency} per 1 USD) to take payments.`);
    const parsed = parseUnits6(given);
    if (parsed === null || parsed <= 0n) throw new BridgeError(422, "needs_rate", "RATE_PER_USD must be a positive number with at most 6 decimals.");
    r = parsed;
  }
  // usdt = a / rate, in micro-units: a * 10^6 / r, rounded half up.
  const u = (2n * a * SCALE + r) / (2n * r);
  if (u <= 0n) throw new BridgeError(422, "amount_too_small", "The total is too small to charge in USDT.");
  if (u >= MAX_UNITS) throw new BridgeError(422, "amount_too_large", "The total is too large.");
  return formatUnits6(u);
}
