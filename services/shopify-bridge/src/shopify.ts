import { BridgeError } from "./util";
import type { TokenProvider } from "./token";

/** Newest stable Admin API version at build time (shopify.dev showed 2026-10 as "latest"). Bump it when Shopify retires it. */
export const API_VERSION = "2026-10";
/** Strict on purpose: this string becomes the host we send the Admin token to, so only `name.myshopify.com` may pass. */
export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const isShopDomain = (s: unknown): s is string => typeof s === "string" && s.length <= 100 && SHOP_RE.test(s);

const TIMEOUT_MS = 15_000;
const MAX_THROTTLE_RETRIES = 3;

type Gql = { data?: any; errors?: { extensions?: { code?: string } }[]; extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } } } };

export type Shopify = { gql: <T = any>(query: string, variables?: Record<string, unknown>) => Promise<T> };

/**
 * A tiny Admin GraphQL client. The token goes into one request header, only to https://{shop}/admin/api/..., redirects are never
 * followed, and upstream error text is never copied into our errors. When Shopify says THROTTLED we wait for the bucket to refill and retry.
 */
export function makeShopify(o: { shop: string; token: string | TokenProvider; fetch: typeof fetch; sleep: (ms: number) => Promise<void> }): Shopify {
  if (!isShopDomain(o.shop)) throw new BridgeError(500, "misconfigured", "SHOPIFY_SHOP_DOMAIN must look like name.myshopify.com.");
  if (!o.token) throw new BridgeError(500, "misconfigured", "No Shopify access token is configured.");
  const tokens: TokenProvider = typeof o.token === "string" ? { get: async () => o.token as string, canRefresh: false } : o.token;
  const url = `https://${o.shop}/admin/api/${API_VERSION}/graphql.json`;

  return {
    async gql<T>(query: string, variables: Record<string, unknown> = {}) {
      let refreshed = false;
      let forceNew = false;
      for (let attempt = 0; ; attempt++) {
        const token = await tokens.get(forceNew);
        forceNew = false;
        let res: Response;
        try {
          res = await o.fetch(url, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": token },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {
          throw new BridgeError(502, "shopify_unreachable", "Could not reach Shopify.");
        }
        if (res.status >= 300 && res.status < 400) throw new BridgeError(502, "shopify_redirect", "Shopify answered with a redirect, which is not followed.");
        if (res.status === 401 && tokens.canRefresh && !refreshed) {
          refreshed = true; // an expired or revoked token: get a fresh one and retry exactly once
          forceNew = true;
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new BridgeError(502, "shopify_denied", "Shopify refused the admin token.");
        if (res.status === 429) {
          if (attempt >= MAX_THROTTLE_RETRIES) throw new BridgeError(502, "shopify_throttled", "Shopify is rate limiting the bridge.");
          await o.sleep((Number(res.headers.get("retry-after")) || 2) * 1000);
          continue;
        }
        if (!res.ok) throw new BridgeError(502, "shopify_error", "Shopify returned an error.");
        let body: Gql;
        try {
          body = (await res.json()) as Gql;
        } catch {
          throw new BridgeError(502, "shopify_bad_response", "Shopify sent an answer that could not be read.");
        }
        const errors = body.errors ?? [];
        if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
          if (attempt >= MAX_THROTTLE_RETRIES) throw new BridgeError(502, "shopify_throttled", "Shopify is rate limiting the bridge.");
          const cost = body.extensions?.cost;
          const rate = cost?.throttleStatus?.restoreRate || 50;
          const short = Math.max((cost?.requestedQueryCost ?? 100) - (cost?.throttleStatus?.currentlyAvailable ?? 0), 1);
          await o.sleep(Math.ceil((short / rate) * 1000));
          continue;
        }
        if (errors.length) throw new BridgeError(502, "shopify_error", "Shopify could not run the request.");
        return body.data as T;
      }
    },
  };
}

/** Accepts `123`, `"123"` or `gid://shopify/<Kind>/123` and returns the global id. Anything else is a 422. */
export function toGid(kind: "DraftOrder" | "ProductVariant" | "Order", v: unknown): string {
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s === "string") {
    if (/^\d{1,20}$/.test(s)) return `gid://shopify/${kind}/${s}`;
    if (new RegExp(`^gid://shopify/${kind}/\\d{1,20}$`).test(s)) return s;
  }
  throw new BridgeError(422, "bad_id", `${kind} id is not valid.`);
}

export const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/** Shopify reports business-rule problems as `userErrors` with a 200. Turn the first into a 422 (the text is Shopify's own, never a secret). */
export function checkUserErrors(payload: { userErrors?: { message?: string }[] } | null | undefined): void {
  const first = payload?.userErrors?.[0];
  if (first) throw new BridgeError(422, "shopify_rejected", `Shopify rejected the request: ${String(first.message ?? "unknown").slice(0, 200)}`);
  if (!payload) throw new BridgeError(502, "shopify_bad_response", "Shopify sent an answer that could not be read.");
}
