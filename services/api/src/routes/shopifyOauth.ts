import { and, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { sessionMerchant } from "../auth";
import { audit } from "../audit";
import { fail } from "../errors";
import { plan } from "../import/shopify/commit";
import { fetchShopify, isShopDomain } from "../import/shopify/graphql";
import { mapSource } from "../import/shopify/map";
import { ImportError, type Source } from "../import/shopify/types";
import { randomHex, sha256Hex } from "../lib/crypto";
import { seal } from "../lib/seal";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { verifyShopifyQuery } from "../shopifyOauth/hmac";
import { CONNECTION_TTL_MS, PENDING_TTL_MS, purgeShopifyOauth } from "../shopifyOauth/store";
import { shopifyConnections, shopifyOauthPending } from "../shopifyOauth/tables";

const READ_ONLY = ["read_products", "read_inventory"];
const PERSONAL = ["read_customers", "read_orders"];
const unavailable = (c: Parameters<typeof fail>[0]) => fail(c, 503, "shopify_unavailable", "Connecting a Shopify store is not available right now. Use the access token or the CSV export instead.");

/** "demo", " Demo-Store " and "demo-store.myshopify.com" all become "demo-store.myshopify.com"; anything else that is not exactly a shop address is null. */
export function shopFromInput(input: string): string | null {
  const v = input.trim().toLowerCase();
  const shop = /^[a-z0-9][a-z0-9-]*$/.test(v) ? `${v}.myshopify.com` : v;
  return isShopDomain(shop) ? shop : null;
}

// ---- the merchant's side (signed in): start, look, discard -------------------------------------------------------------

export const shopifyConnectRoutes = new Hono<AppEnv>();

shopifyConnectRoutes.post("/connect", async (c) => {
  const { SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: secret } = c.env;
  if (!clientId || !secret) return unavailable(c);
  const parsed = z.strictObject({ shop: z.string().max(100), includeCustomers: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const shop = shopFromInput(parsed.data.shop);
  if (!shop) return fail(c, 400, "bad_shop", "Enter your store name, like your-store (or your-store.myshopify.com).");
  const { db, merchantId } = c.var;
  const now = c.var.now();
  if (!(await hitRateLimit(db, `shopify-connect:${merchantId}`, 10, 3600, now))) return fail(c, 429, "rate_limited", "Too many tries. Try again later.");

  await purgeShopifyOauth(db, now);
  const state = randomHex(32);
  await db.insert(shopifyOauthPending).values({
    id: randomHex(16),
    merchantId,
    shop,
    stateHash: await sha256Hex(state),
    includeCustomers: parsed.data.includeCustomers ? 1 : 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
  });
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", [...READ_ONLY, ...(parsed.data.includeCustomers ? PERSONAL : [])].join(","));
  url.searchParams.set("redirect_uri", `${c.env.API_URL}/auth/shopify/callback`);
  url.searchParams.set("state", state);
  return c.json({ authorizeUrl: url.toString() });
});

/** What the wizard needs after the browser comes back: which shop, and the dry-run report. Never the token. */
shopifyConnectRoutes.get("/connection", async (c) => {
  const { db, merchantId } = c.var;
  const now = c.var.now();
  await purgeShopifyOauth(db, now);
  const [row] = await db
    .select()
    .from(shopifyConnections)
    .where(and(eq(shopifyConnections.merchantId, merchantId), gt(shopifyConnections.expiresAt, now.toISOString())))
    .orderBy(desc(shopifyConnections.createdAt))
    .limit(1);
  if (!row) return c.json({ connection: null });
  const report = row.report ? JSON.parse(row.report) : null;
  return c.json({ connection: { shop: row.shop, includeCustomers: row.includeCustomers === 1, currency: row.currency, expiresAt: row.expiresAt, report, needsRate: report === null } });
});

shopifyConnectRoutes.delete("/connection", async (c) => {
  await c.var.db.delete(shopifyConnections).where(eq(shopifyConnections.merchantId, c.var.merchantId));
  return c.json({ ok: true });
});

// ---- where Shopify sends the browser back ------------------------------------------------------------------------------

/** The only words that ever appear in the address we send the browser to; whatever else went wrong is "preview_failed". */
const PREVIEW_ERRORS = new Set(["bad_shop", "bad_token", "shopify_unreachable", "shopify_redirect", "shopify_denied", "shopify_not_found", "shopify_throttled", "shopify_error", "shopify_bad_response", "missing_scope"]);

export const shopifyCallbackRoutes = new Hono<AppEnv>();

shopifyCallbackRoutes.get("/callback", async (c) => {
  const { SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: secret } = c.env;
  if (!clientId || !secret) return unavailable(c);
  const query = new URL(c.req.url).searchParams;
  // 1. Shopify really sent this (nobody can forge or edit the parameters without the client secret).
  if (!(await verifyShopifyQuery(query, secret))) return fail(c, 400, "invalid_request", "This request did not come from Shopify.");
  const shop = query.get("shop") ?? "";
  if (!isShopDomain(shop)) return fail(c, 400, "invalid_request", "That is not a Shopify store address.");
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  const { db } = c.var;
  const now = c.var.now();
  await purgeShopifyOauth(db, now);
  // 2. The state is one we issued, still live, for this same shop.
  const [pending] = /^[0-9a-f]{64}$/.test(state)
    ? await db.select().from(shopifyOauthPending).where(and(eq(shopifyOauthPending.stateHash, await sha256Hex(state)), gt(shopifyOauthPending.expiresAt, now.toISOString())))
    : [];
  if (!pending || pending.shop !== shop || !code || code.length > 512) return fail(c, 400, "invalid_state", "This connection link has expired or was already used. Start again from the import page.");
  // 3. And it belongs to the business that is signed in here. A mismatch does not use the state up.
  const back = (qs: string) => c.redirect(`${c.env.APP_URL}/dashboard/import?${qs}`, 302);
  const me = await sessionMerchant(c);
  if (!me) return back("shopify_error=signed_out");
  if (me.id !== pending.merchantId) return fail(c, 403, "forbidden", "This connection was started by another business.");
  // 4. Use it up. From here on the code can be exchanged exactly once.
  const [claimed] = await db.delete(shopifyOauthPending).where(eq(shopifyOauthPending.id, pending.id)).returning({ id: shopifyOauthPending.id });
  if (!claimed) return fail(c, 400, "invalid_state", "This connection link has expired or was already used. Start again from the import page.");

  // From the next line the access token exists in memory. It is sealed, used for the preview and never logged, returned or put in an address:
  // every failure below becomes one of a fixed set of words, and nothing is logged.
  try {
    const include = pending.includeCustomers === 1;
    const token = await exchange(c.var.fetch, shop, clientId, secret, code, include ? [...READ_ONLY, ...PERSONAL] : READ_ONLY);
    if (token === "scope_missing") return back("shopify_error=scope_missing");
    if (!token) return back("shopify_error=exchange_failed");

    let src: Source;
    try {
      src = await fetchShopify({ shop, token, fetch: c.var.fetch, include: include ? { customers: true, orders: true } : {} });
    } catch (e) {
      return back(`shopify_error=${e instanceof ImportError && PREVIEW_ERRORS.has(e.code) ? e.code : "preview_failed"}`);
    }
    let report: string | null = null;
    try {
      report = JSON.stringify((await plan(db, me.id, mapSource(src, {}), "api", include)).report);
    } catch (e) {
      // A shop that sells in another currency needs the merchant's rate before it can be previewed; the connection is still good.
      if (!(e instanceof ImportError && (e.code === "needs_rate" || e.code === "needs_currency"))) return back(`shopify_error=${e instanceof ImportError && PREVIEW_ERRORS.has(e.code) ? e.code : "preview_failed"}`);
    }

    const row = {
      id: randomHex(16),
      merchantId: me.id,
      shop,
      sealedToken: await seal(secret, token, [me.id, shop]),
      includeCustomers: include ? 1 : 0,
      currency: src.currency,
      report,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CONNECTION_TTL_MS).toISOString(),
    };
    await db.insert(shopifyConnections).values(row).onConflictDoUpdate({ target: [shopifyConnections.merchantId, shopifyConnections.shop], set: row });
    await audit(db, { merchantId: me.id, actor: `merchant:${me.id}`, action: "import.shopify.connected", payload: { shop, includeCustomers: include } });
    return back("connected=shopify");
  } catch {
    return back("shopify_error=internal");
  }
});

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** Trades the one-time code for the shop's access token. Null on any failure; "scope_missing" if Shopify granted less than we asked for. Redirects are not followed. */
async function exchange(f: typeof fetch, shop: string, clientId: string, clientSecret: string, code: string, wanted: string[]): Promise<string | "scope_missing" | null> {
  try {
    const res = await f(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: unknown; scope?: unknown };
    if (typeof body.access_token !== "string" || !TOKEN.test(body.access_token)) return null;
    if (typeof body.scope === "string") {
      const granted = new Set(body.scope.split(",").map((s) => s.trim()));
      if (!wanted.every((s) => granted.has(s))) return "scope_missing";
    }
    return body.access_token;
  } catch {
    return null;
  }
}
