const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

/** "12.50" -> 12500000n. Throws on anything that is not a plain decimal with at most 6 places. */
export function toUnits(s: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`invalid USDT amount: "${s}"`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole!) * SCALE + BigInt(frac.padEnd(DECIMALS, "0"));
}

/** 12500000n -> "12.5". Trailing zeros trimmed. */
export function fromUnits(n: bigint): string {
  if (n < 0n) throw new Error("negative amount");
  const whole = n / SCALE;
  const frac = (n % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** 12500000n -> "$12.50" (always at least two decimals). */
export function formatUSDT(n: bigint): string {
  const [whole, frac = ""] = fromUnits(n).split(".");
  return `$${whole}.${frac.padEnd(2, "0")}`;
}
