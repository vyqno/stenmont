import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeShopifyOauth } from "../../src/shopifyOauth/store";
import { APP_IMPORT, CLIENT_ID, ENV, SECRET, SHOP, TOKEN, j, location, world, type Opts, type World } from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("using the connection to import", () => {
  const preview = (w: World, body: object, c = w.c1) => w.call("/v1/import/shopify/preview", c, { method: "POST", body: JSON.stringify(body) });
  const commit = (w: World, body: object, c = w.c1) => w.call("/v1/import/shopify/commit", c, { method: "POST", body: JSON.stringify({ confirm: true, ...body }) });
  const connected = async (o: Opts = {}) => {
    const w = await world(o);
    await w.callback(w.okQuery(await w.begin()));
    return w;
  };

  it("previews and commits without the merchant pasting anything, then forgets the token", async () => {
    const w = await connected();
    const p = await preview(w, { source: "connected", shop: SHOP });
    expect(p.status).toBe(200);
    expect((await j(p)).report.counts.products).toBe(2);
    expect(await w.count("products")).toBe(0);
    expect(await w.count("shopify_connections")).toBe(1); // a preview does not use it up

    const before = w.s.graphql().length;
    const done = await commit(w, { source: "connected", shop: SHOP });
    expect(done.status).toBe(200);
    expect((await j(done)).result).toEqual({ created: 2, updated: 0, skipped: 0 });
    expect(await w.count("products")).toBe(2);
    expect(await w.count("shopify_connections")).toBe(0); // gone as soon as the import ran
    const used = w.s.graphql().slice(before);
    expect(used.length).toBeGreaterThan(0);
    for (const c of used) expect((c.init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(TOKEN);
    expect(await w.everything()).not.toContain(TOKEN);
  });

  it("can be used once only", async () => {
    const w = await connected();
    expect((await commit(w, { source: "connected", shop: SHOP })).status).toBe(200);
    const again = await commit(w, { source: "connected", shop: SHOP });
    expect(again.status).toBe(422);
    expect((await j(again)).error.code).toBe("not_connected");
    expect((await preview(w, { source: "connected", shop: SHOP })).status).toBe(422);
  });

  it("two commits racing use the token once", async () => {
    const w = await connected();
    const [a, b] = await Promise.all([commit(w, { source: "connected", shop: SHOP }), commit(w, { source: "connected", shop: SHOP })]);
    expect([a.status, b.status].sort()).toEqual([200, 422]);
  });

  it("does not need a confirm for the preview but demands one for the commit", async () => {
    const w = await connected();
    const res = await w.call("/v1/import/shopify/commit", w.c1, { method: "POST", body: JSON.stringify({ source: "connected", shop: SHOP }) });
    expect(res.status).toBe(400);
    expect(await w.count("shopify_connections")).toBe(1);
  });

  it("is not available to another business, or for another shop", async () => {
    const w = await connected();
    expect((await commit(w, { source: "connected", shop: SHOP }, w.c2)).status).toBe(422);
    expect((await commit(w, { source: "connected", shop: "other-store.myshopify.com" })).status).toBe(422);
    expect((await commit(w, { source: "connected", shop: "evil.com" })).status).toBe(400);
    expect(await w.count("shopify_connections")).toBe(1);
    expect(await w.count("products")).toBe(0);
  });

  it("does not open for a different merchant even if the row is moved to them", async () => {
    const w = await connected();
    await w.t.db.prepare("update shopify_connections set merchant_id = 'm_2'").run();
    const res = await commit(w, { source: "connected", shop: SHOP }, w.c2);
    expect(res.status).toBe(422);
    expect(w.s.graphql().filter((c) => (c.init.headers as any)["X-Shopify-Access-Token"] !== TOKEN)).toHaveLength(0);
    expect(await w.count("products")).toBe(0);
  });

  it("does not open for a different shop even if the row is relabelled", async () => {
    const w = await connected();
    await w.t.db.prepare("update shopify_connections set shop = 'other-store.myshopify.com'").run();
    const res = await commit(w, { source: "connected", shop: "other-store.myshopify.com" });
    expect(res.status).toBe(422);
    expect(await w.count("products")).toBe(0);
  });

  it("expires after 15 minutes", async () => {
    const w = await connected();
    w.t.clock.now = new Date(w.t.clock.now.getTime() + 15 * 60_000 + 1000);
    expect((await commit(w, { source: "connected", shop: SHOP })).status).toBe(422);
    expect((await j(await w.call("/v1/import/shopify/connection", w.c1))).connection).toBeNull();
    expect(await w.count("products")).toBe(0);
    expect(await w.count("shopify_connections")).toBe(0); // and the expired row was removed
  });

  it("asks for a rate when the shop sells in another currency, then imports with it", async () => {
    const w = await world({ currency: "EUR" });
    await w.callback(w.okQuery(await w.begin()));
    const noRate = await preview(w, { source: "connected", shop: SHOP });
    expect(noRate.status).toBe(422);
    expect((await j(noRate)).error.code).toBe("needs_rate");
    const ok = await preview(w, { source: "connected", shop: SHOP, rate: "1.08" });
    expect((await j(ok)).report.rate).toBe("1.08");
    expect((await commit(w, { source: "connected", shop: SHOP, rate: "1.08" })).status).toBe(200);
  });

  it("writes an audit row for the import without the token", async () => {
    const w = await connected();
    await commit(w, { source: "connected", shop: SHOP });
    const rows = (await w.t.db.prepare("select payload from audit_log where action = 'import.shopify.committed'").all()).results as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).not.toContain(TOKEN);
  });

  it("keeps the paste-token and CSV routes working", async () => {
    const w = await connected();
    const api = await preview(w, { source: "api", shop: SHOP, token: TOKEN });
    expect(api.status).toBe(200);
    expect(await w.count("shopify_connections")).toBe(1);
  });

  it("can be discarded by the merchant", async () => {
    const w = await connected();
    expect((await w.call("/v1/import/shopify/connection", w.c2, { method: "DELETE" })).status).toBe(200);
    expect(await w.count("shopify_connections")).toBe(1); // B cannot delete A's
    expect((await w.call("/v1/import/shopify/connection", w.c1, { method: "DELETE" })).status).toBe(200);
    expect(await w.count("shopify_connections")).toBe(0);
  });
});

describe("purging", () => {
  it("removes expired pending and connection rows, and only those", async () => {
    const w = await world();
    const live = await w.begin();
    expect(live).toBeTruthy();
    const second = "second-store.myshopify.com";
    await w.callback(w.okQuery((await w.begin({ shop: second })), {}, second));
    w.t.clock.now = new Date(w.t.clock.now.getTime() + 11 * 60_000);
    await purgeShopifyOauth(drizzle(w.t.db), w.t.clock.now);
    expect(await w.count("shopify_oauth_pending")).toBe(0);
    expect(await w.count("shopify_connections")).toBe(1);
    w.t.clock.now = new Date(w.t.clock.now.getTime() + 5 * 60_000);
    await purgeShopifyOauth(drizzle(w.t.db), w.t.clock.now);
    expect(await w.count("shopify_connections")).toBe(0);
  });

  it("happens by itself when a new connection is started", async () => {
    const w = await world();
    await w.begin();
    w.t.clock.now = new Date(w.t.clock.now.getTime() + 11 * 60_000);
    await w.begin({ shop: "second-store.myshopify.com" });
    expect(await w.count("shopify_oauth_pending")).toBe(1);
  });
});

