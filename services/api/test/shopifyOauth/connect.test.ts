import { drizzle } from "drizzle-orm/d1";
import { sha256Hex } from "../../src/lib/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_IMPORT, CLIENT_ID, ENV, SECRET, SHOP, TOKEN, j, location, world, type Opts, type World } from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/import/shopify/connect", () => {
  it("needs a signed-in business", async () => {
    const w = await world();
    expect((await w.call("/v1/import/shopify/connect", null, { method: "POST", body: JSON.stringify({ shop: SHOP }) })).status).toBe(401);
  });

  it("answers 503 shopify_unavailable when the app is not configured", async () => {
    for (const env of [{}, { SHOPIFY_CLIENT_ID: CLIENT_ID }, { SHOPIFY_CLIENT_SECRET: SECRET }]) {
      const w = await world({}, env);
      const res = await w.connect({ shop: SHOP });
      expect(res.status).toBe(503);
      expect((await j(res)).error.code).toBe("shopify_unavailable");
      expect(await w.count("shopify_oauth_pending")).toBe(0);
    }
  });

  it("returns Shopify's consent address with read-only scopes, our callback and a fresh state", async () => {
    const w = await world();
    const res = await w.connect({ shop: SHOP });
    const url = new URL((await j(res)).authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("read_products,read_inventory");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.test/auth/shopify/callback");
    const state = url.searchParams.get("state")!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.has("grant_options[]")).toBe(false); // offline token, not a per-user one
    expect(JSON.stringify(await w.everything())).not.toContain(state); // only a hash is kept
    const row = (await w.t.db.prepare("select * from shopify_oauth_pending").first()) as any;
    expect(row).toMatchObject({ merchant_id: "m_1", shop: SHOP, state_hash: await sha256Hex(state), include_customers: 0 });
    expect(Date.parse(row.expires_at) - w.t.clock.now.getTime()).toBe(10 * 60_000);
  });

  it("asks for customers and orders only when the merchant chose them", async () => {
    const w = await world();
    const url = new URL((await j(await w.connect({ shop: SHOP, includeCustomers: true }))).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("read_products,read_inventory,read_customers,read_orders");
  });

  it("accepts a bare store name and tidies case and spaces", async () => {
    const w = await world();
    for (const shop of ["demo-store", " Demo-Store ", "DEMO-STORE.MYSHOPIFY.COM"]) {
      const url = new URL((await j(await w.connect({ shop }))).authorizeUrl);
      expect(url.host).toBe(SHOP);
    }
  });

  it.each([
    "", "evil.com", "demo.myshopify.com.evil.com", "demo.myshopify.com/x", "https://demo.myshopify.com", "demo.myshopify.com:443", "user@demo.myshopify.com",
    "demo.myshopify.com@evil.com", "127.0.0.1", "a.b.myshopify.com", "demo.myshopify.com#", "demo.myshopify.com?x=1", "-demo", "de mo", "de\nmo", "demo/evil", "demo.myshopify.com\\@evil.com", "xn--demo.com", "a".repeat(120),
  ])("refuses the shop %j before anything is stored", async (shop) => {
    const w = await world();
    const res = await w.connect({ shop });
    expect(res.status).toBe(400);
    expect(await w.count("shopify_oauth_pending")).toBe(0);
  });

  it("refuses unknown fields and a non-boolean includeCustomers", async () => {
    const w = await world();
    expect((await w.connect({ shop: SHOP, surprise: 1 })).status).toBe(400);
    expect((await w.connect({ shop: SHOP, includeCustomers: "yes" })).status).toBe(400);
    expect((await w.call("/v1/import/shopify/connect", w.c1, { method: "POST", body: "nope" })).status).toBe(400);
  });

  it("limits how often a business can start a connection", async () => {
    const w = await world();
    for (let i = 0; i < 10; i++) expect((await w.connect({ shop: SHOP })).status).toBe(200);
    expect((await w.connect({ shop: SHOP })).status).toBe(429);
  });

  it("must come from our own app", async () => {
    const w = await world();
    const res = await w.t.req("/v1/import/shopify/connect", { method: "POST", headers: { cookie: w.c1, origin: "https://evil.test" }, body: JSON.stringify({ shop: SHOP }) });
    expect(res.status).toBe(403);
  });
});

