import type { Bindings, Deps } from "./env";
import { BridgeError } from "./util";

/** Gives the Admin API token. `get(true)` forces a fresh one (after a 401). `canRefresh` is false for a fixed override token. */
export type TokenProvider = { get: (force?: boolean) => Promise<string>; canRefresh: boolean };

const KV_KEY = "shopify:token";
const SAFETY_MS = 5 * 60_000; // treat the token as expired 5 minutes early
// One refresh at a time per shop inside this isolate; other isolates may refresh once each, which is harmless (Shopify accepts it).
// ponytail: no cross-isolate lock; add a Durable Object only if refreshes ever need to be globally single.
const inflight = new Map<string, Promise<string>>();

/** The secret Shopify signs webhooks with is the app's client secret, so it is also the default webhook secret. */
export const webhookSecret = (env: Pick<Bindings, "SHOPIFY_WEBHOOK_SECRET" | "SHOPIFY_CLIENT_SECRET">) => env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET || "";

/**
 * Dev Dashboard apps have no static Admin token. For a store in the same organization as the app, the token comes from the
 * client credentials grant (POST https://{shop}/admin/oauth/access_token, form-encoded, valid 24 hours). It is cached in KV and
 * never logged or returned. SHOPIFY_ADMIN_TOKEN, if set, is used as is (a legacy token): it never refreshes.
 */
export function tokenProvider(env: Bindings, deps: Deps): TokenProvider {
  if (env.SHOPIFY_ADMIN_TOKEN) return { get: async () => env.SHOPIFY_ADMIN_TOKEN!, canRefresh: false };
  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) throw new BridgeError(500, "misconfigured", "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN).");
  const shop = env.SHOPIFY_SHOP_DOMAIN;

  async function fetchToken(): Promise<string> {
    let res: Response;
    try {
      res = await deps.fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID!, client_secret: env.SHOPIFY_CLIENT_SECRET! }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BridgeError(502, "shopify_unreachable", "Could not reach Shopify to get an access token.");
    }
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      // The docs name shop_not_permitted but not the status or body shape, so look for the code in either.
      if (/shop_not_permitted/.test(raw)) throw new BridgeError(502, "shopify_shop_not_permitted", "Shopify says client credentials cannot be used on this shop: the app and the store must be in the same organization.");
      if (/invalid_client/.test(raw) || res.status === 401) throw new BridgeError(502, "shopify_invalid_client", "Shopify rejected SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET.");
      throw new BridgeError(502, "shopify_token_error", "Shopify did not give an access token.");
    }
    let j: { access_token?: unknown; expires_in?: unknown };
    try {
      j = JSON.parse(raw);
    } catch {
      throw new BridgeError(502, "shopify_bad_response", "Shopify sent a token answer that could not be read.");
    }
    if (typeof j.access_token !== "string" || !j.access_token) throw new BridgeError(502, "shopify_bad_response", "Shopify sent no access token.");
    const secs = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 86_399;
    const expiresAt = deps.now() + secs * 1000;
    await env.STATE.put(KV_KEY, JSON.stringify({ token: j.access_token, expiresAt }), { expirationTtl: Math.max(60, secs) });
    return j.access_token;
  }

  return {
    canRefresh: true,
    async get(force = false) {
      if (!force) {
        const c = await env.STATE.get<{ token: string; expiresAt: number }>(KV_KEY, "json");
        if (c && typeof c.token === "string" && c.expiresAt - SAFETY_MS > deps.now()) return c.token;
      }
      let p = inflight.get(shop);
      if (!p) {
        p = fetchToken().finally(() => inflight.delete(shop));
        inflight.set(shop, p);
      }
      return p;
    },
  };
}
