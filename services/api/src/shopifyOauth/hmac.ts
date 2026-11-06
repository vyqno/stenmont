import { hmacSha256Hex, timingSafeEqual } from "../lib/crypto";

const key = (k: string) => k.replaceAll("%", "%25").replaceAll("&", "%26").replaceAll("=", "%3D");
const value = (v: string) => v.replaceAll("%", "%25").replaceAll("&", "%26");

/**
 * Checks the `hmac` Shopify adds to the redirect back to us: every other parameter, sorted by name, written k=v and joined
 * with &, signed with the app's client secret (HMAC-SHA256, hex). The comparison takes the same time wherever it differs.
 * Repeated parameters are refused outright: a second `hmac` or a doubled `code` must never be able to pick which one counts.
 * ponytail: the escaping of %, & and = follows Shopify's documented rule as I know it; not re-checked against Shopify's current docs.
 */
export async function verifyShopifyQuery(params: URLSearchParams, clientSecret: string): Promise<boolean> {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return false;
  const given = params.get("hmac");
  if (!given || !/^[0-9a-f]{64}$/.test(given)) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${key(k)}=${value(v)}`)
    .join("&");
  return timingSafeEqual(given, await hmacSha256Hex(clientSecret, message));
}
