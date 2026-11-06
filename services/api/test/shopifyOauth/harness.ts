import { createHmac } from "node:crypto";
import { drizzle } from "drizzle-orm/d1";
import { expect } from "vitest";
import { sessions } from "../../src/db/schema";
import { sha256Hex } from "../../src/lib/crypto";
import { seedMerchant, setup } from "../helpers/app";


export const CLIENT_ID = "fixture-client-id";
export const SECRET = "fixture-client-secret-0123456789";
export const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");
export const SHOP = "demo-store.myshopify.com";
export const ENV = { SHOPIFY_CLIENT_ID: CLIENT_ID, SHOPIFY_CLIENT_SECRET: SECRET };
export const APP_IMPORT = "https://app.test/dashboard/import";

export type Opts = { exchange?: (body: any) => Response | Error; scope?: string; currency?: string; graphqlStatus?: number };

/** A pretend Shopify: the token exchange and the Admin GraphQL API. Never the real one. */
function shopify(o: Opts = {}) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, init, body });
    if (url.endsWith("/admin/oauth/access_token")) {
      const out = o.exchange ? o.exchange(body) : Response.json({ access_token: TOKEN, scope: o.scope ?? "read_products,read_inventory,read_customers,read_orders" });
      if (out instanceof Error) throw out;
      return out;
    }
    if (o.graphqlStatus) return new Response("{}", { status: o.graphqlStatus });
    const op = /query\s+(\w+)/.exec(body.query)![1];
    const data =
      op === "Shop" ? { shop: { currencyCode: o.currency ?? "USD" } }
      : op === "Products" ? { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [product(1), product(2)] } }
      : op === "Customers" ? { customers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ email: "ada@example.test", firstName: "Ada", lastName: "E", defaultAddress: { countryCodeV2: "GB" }, emailMarketingConsent: { marketingState: "SUBSCRIBED" } }] } }
      : { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
    return Response.json({ data, extensions: { cost: { requestedQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 990, restoreRate: 50 } } } });
  }) as unknown as typeof fetch;
  return { f, calls, graphql: () => calls.filter((c) => c.url.includes("/graphql.json")) };
}
const product = (n: number) => ({
  handle: `item-${n}`, title: `Item ${n}`, descriptionHtml: "<p>d</p>", vendor: "V", productType: "T", tags: [], status: "ACTIVE",
  variants: { pageInfo: { hasNextPage: false }, nodes: [{ sku: `S${n}`, title: "Default Title", price: "10.00", selectedOptions: [{ name: "Title", value: "Default Title" }], inventoryQuantity: 4, inventoryItem: { tracked: true } }] },
  media: { nodes: [] }, collections: { nodes: [] },
});

export async function world(o: Opts = {}, env: object = ENV) {
  const s = shopify(o);
  const t = setup({}, env, { fetch: s.f });
  await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
  await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const cookie = async (merchantId: string) => {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await drizzle(t.db).insert(sessions).values({ tokenHash: await sha256Hex(token), merchantId, passkeyId: "p", createdAt: t.clock.now.toISOString(), expiresAt: new Date(t.clock.now.getTime() + 86_400_000).toISOString() });
    return `__Secure-stenmont_test=${token}`;
  };
  const c1 = await cookie("m_1");
  const c2 = await cookie("m_2");
  const call = (path: string, cookieHeader: string | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookieHeader) headers.set("cookie", cookieHeader);
    if (init.method && init.method !== "GET") headers.set("origin", "https://app.test");
    return t.req(path, { ...init, headers });
  };
  const connect = (body: unknown, c = c1) => call("/v1/import/shopify/connect", c, { method: "POST", body: JSON.stringify(body) });
  /** Starts a connection and returns the state Shopify would send back. */
  const begin = async (body: object = { shop: SHOP }, c = c1) => {
    const res = await connect(body, c);
    expect(res.status).toBe(200);
    return new URL(((await res.json()) as any).authorizeUrl).searchParams.get("state")!;
  };
  /** The redirect back from Shopify, signed with the client secret like Shopify does (independently of our code). */
  const signed = (params: Record<string, string>, secret = SECRET) => {
    const message = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    return new URLSearchParams({ ...params, hmac: createHmac("sha256", secret).update(message).digest("hex") });
  };
  const callback = (q: URLSearchParams | string, c: string | null = c1) => call(`/auth/shopify/callback?${q}`, c);
  const okQuery = (state: string, extra: Record<string, string> = {}, shop = SHOP) => signed({ code: "code-1", shop, state, timestamp: "1793000000", host: "YWJj", ...extra });
  const count = async (table: string) => ((await t.db.prepare(`select count(*) as n from ${table}`).first()) as { n: number }).n;
  const everything = async () => {
    const out: unknown[] = [];
    for (const tbl of ["shopify_oauth_pending", "shopify_connections", "audit_log", "products", "variants", "sessions", "rate_limits"]) out.push((await t.db.prepare(`select * from ${tbl}`).all()).results);
    return JSON.stringify(out);
  };
  return { t, s, c1, c2, call, connect, begin, signed, callback, okQuery, count, everything };
}
export const j = async (r: Response) => (await r.json()) as any;
export const location = (r: Response) => r.headers.get("location");
export type World = Awaited<ReturnType<typeof world>>;
