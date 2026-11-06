import { normalizeShop } from "./catalog";

/** "demo" -> "demo.myshopify.com"; a pasted address or admin link works too. Null unless it is exactly a Shopify store. */
export function shopFromName(input: string): string | null {
  const v = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(v) ? `${v}.myshopify.com` : normalizeShop(v);
}

export const connectProblem = (input: string): string | null => (shopFromName(input) ? null : "Enter your store name, like your-store (the part before .myshopify.com).");

/** Only the shop and the customers choice leave the browser. Shopify's own page does the sign-in and the consent. */
export const connectRequest = (input: string, includeCustomers: boolean) => ({ shop: shopFromName(input) ?? input.trim(), includeCustomers });

/** The browser is sent to the address the API returned; it must be Shopify's consent page for a store, over https, or we stay put. */
export function isShopifyConsentUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(u.hostname) && u.pathname === "/admin/oauth/authorize" && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

const REASONS: Record<string, string> = {
  signed_out: "You were signed out while connecting. Sign in and try again.",
  exchange_failed: "Shopify did not finish the connection. Try again.",
  scope_missing: "Shopify did not give us a permission we need. Connect again and accept all the read-only permissions.",
  shopify_denied: "Shopify refused the connection. Try again.",
  missing_scope: "Shopify did not give us a permission we need. Connect again and accept all the read-only permissions.",
  shopify_unreachable: "We could not reach Shopify. Try again in a moment.",
  shopify_not_found: "Shopify has no store at that address.",
  shopify_throttled: "Shopify is limiting requests right now. Try again in a few minutes.",
};
const FALLBACK = "The connection could not be completed. Try again.";

/** What the import page does when Shopify's flow sends the browser back (`?connected=shopify` or `?shopify_error=code`). Unknown text is never shown. */
export function returnFromShopify(search: string): { kind: "connected" } | { kind: "error"; message: string } | null {
  const p = new URLSearchParams(search);
  if (p.get("connected") === "shopify") return { kind: "connected" };
  const e = p.get("shopify_error");
  return e === null ? null : { kind: "error", message: REASONS[e] ?? FALLBACK };
}

/** Preview and import for a store connected with one click: the server holds the access token, so only the shop (and a rate, if needed) are sent. */
export const connectedRequest = (shop: string, rate: string, confirm: boolean) => ({
  source: "connected" as const,
  shop,
  ...(rate.trim() ? { rate: rate.trim() } : {}),
  ...(confirm ? { confirm: true as const } : {}),
});
