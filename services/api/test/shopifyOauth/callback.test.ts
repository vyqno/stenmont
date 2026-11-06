import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_IMPORT, CLIENT_ID, ENV, SECRET, SHOP, TOKEN, j, location, world, type Opts, type World } from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("GET /auth/shopify/callback: the happy path", () => {
  it("exchanges the code, seals the token, previews, and sends the browser to the wizard", async () => {
    const w = await world();
    const state = await w.begin();
    const res = await w.callback(w.okQuery(state));
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`${APP_IMPORT}?connected=shopify`);

    const ex = w.s.calls.find((c) => c.url.endsWith("/admin/oauth/access_token"))!;
    expect(ex.url).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(ex.init.method).toBe("POST");
    expect(ex.init.redirect).toBe("manual");
    expect(ex.body).toEqual({ client_id: CLIENT_ID, client_secret: SECRET, code: "code-1" });
    expect(w.s.graphql().length).toBeGreaterThan(0);
    expect(w.s.graphql()[0]!.init.redirect).toBe("manual");

    expect(await w.count("shopify_oauth_pending")).toBe(0); // the state is used up
    const row = (await w.t.db.prepare("select * from shopify_connections").first()) as any;
    expect(row).toMatchObject({ merchant_id: "m_1", shop: SHOP, include_customers: 0, currency: "USD" });
    expect(row.sealed_token).not.toContain(TOKEN);
    expect(Date.parse(row.expires_at) - w.t.clock.now.getTime()).toBe(15 * 60_000);
    expect(JSON.parse(row.report).counts.products).toBe(2);
  });

  it("shows the merchant the report, never the token", async () => {
    const w = await world();
    await w.callback(w.okQuery(await w.begin()));
    const res = await w.call("/v1/import/shopify/connection", w.c1);
    const body = await j(res);
    expect(body.connection).toMatchObject({ shop: SHOP, includeCustomers: false, needsRate: false, currency: "USD" });
    expect(body.connection.report.counts).toMatchObject({ products: 2, variants: 2 });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("sealed");
    expect(w.s.calls.length).toBeGreaterThan(0);
    expect((await j(await w.call("/v1/import/shopify/connection", w.c2))).connection).toBeNull(); // another business sees nothing
  });

  it("never lets the token reach a response, header, redirect, log, audit row or any table in plain text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const w = await world();
    const res = await w.callback(w.okQuery(await w.begin()));
    const seen = [location(res), JSON.stringify([...res.headers]), await res.text(), await w.everything()];
    for (const s of seen) expect(s).not.toContain(TOKEN);
    expect(await w.everything()).not.toContain(SECRET);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
    const audits = ((await w.t.db.prepare("select action, payload from audit_log where action like 'import.shopify%'").all()).results as any[]).map((r) => r.action);
    expect(audits).toContain("import.shopify.connected");
  });

  it("includes customers and orders when they were asked for and granted", async () => {
    const w = await world();
    await w.callback(w.okQuery(await w.begin({ shop: SHOP, includeCustomers: true })));
    const row = (await w.t.db.prepare("select * from shopify_connections").first()) as any;
    expect(row.include_customers).toBe(1);
    expect(JSON.parse(row.report).counts.customers).toBe(1);
    expect(row.report).not.toContain("ada@example.test");
  });

  it("ignores a redirect-looking parameter: the destination is fixed", async () => {
    const w = await world();
    const state = await w.begin();
    const res = await w.callback(w.okQuery(state, { next: "https://evil.test/steal", redirect: "//evil.test", return_to: "https://evil.test" }));
    expect(location(res)).toBe(`${APP_IMPORT}?connected=shopify`);
  });

  it("replaces an earlier connection to the same shop", async () => {
    const w = await world();
    await w.callback(w.okQuery(await w.begin()));
    await w.callback(w.okQuery(await w.begin()));
    expect(await w.count("shopify_connections")).toBe(1);
  });

  it("keeps the connection when the shop's currency needs a rate, and reports that", async () => {
    const w = await world({ currency: "EUR" });
    const res = await w.callback(w.okQuery(await w.begin()));
    expect(location(res)).toBe(`${APP_IMPORT}?connected=shopify`);
    const c = (await j(await w.call("/v1/import/shopify/connection", w.c1))).connection;
    expect(c).toMatchObject({ needsRate: true, currency: "EUR", report: null });
  });
});

describe("GET /auth/shopify/callback: refusals", () => {
  async function untouched(w: World) {
    expect(w.s.calls).toHaveLength(0); // we never even called Shopify
    expect(await w.count("shopify_connections")).toBe(0);
  }

  it("refuses a missing or forged signature", async () => {
    const w = await world();
    const state = await w.begin();
    const good = w.okQuery(state);
    const noHmac = new URLSearchParams(good);
    noHmac.delete("hmac");
    const wrongSecret = w.signed({ code: "code-1", shop: SHOP, state, timestamp: "1793000000", host: "YWJj" }, "not-the-secret");
    const junk = new URLSearchParams(good);
    junk.set("hmac", "0".repeat(64));
    for (const q of [noHmac, wrongSecret, junk]) {
      const res = await w.callback(q);
      expect(res.status).toBe(400);
      expect(location(res)).toBeNull();
    }
    await untouched(w);
    expect(await w.count("shopify_oauth_pending")).toBe(1); // a forged request cannot burn the real state
  });

  it("refuses a query whose parameter was changed after signing", async () => {
    const w = await world();
    const state = await w.begin();
    for (const [k, v] of [["code", "other"], ["state", "f".repeat(64)], ["shop", "other.myshopify.com"], ["timestamp", "1"]] as const) {
      const q = w.okQuery(state);
      q.set(k, v);
      expect((await w.callback(q)).status).toBe(400);
    }
    const added = w.okQuery(state);
    added.set("extra", "1");
    expect((await w.callback(added)).status).toBe(400);
    const dup = new URLSearchParams(w.okQuery(state));
    dup.append("code", "code-2");
    expect((await w.callback(dup)).status).toBe(400);
    await untouched(w);
  });

  it("refuses an unknown state", async () => {
    const w = await world();
    const res = await w.callback(w.okQuery("a".repeat(64)));
    expect(res.status).toBe(400);
    expect((await j(res)).error.code).toBe("invalid_state");
    await untouched(w);
  });

  it("refuses a state that has expired", async () => {
    const w = await world();
    const state = await w.begin();
    w.t.clock.now = new Date(w.t.clock.now.getTime() + 10 * 60_000 + 1000);
    const res = await w.callback(w.okQuery(state));
    expect(res.status).toBe(400);
    await untouched(w);
  });

  it("refuses a state that was already used", async () => {
    const w = await world();
    const state = await w.begin();
    expect((await w.callback(w.okQuery(state))).status).toBe(302);
    const calls = w.s.calls.length;
    const again = await w.callback(w.okQuery(state));
    expect(again.status).toBe(400);
    expect(w.s.calls.length).toBe(calls); // no second exchange
  });

  it("refuses a state used for a different shop, even with a valid signature", async () => {
    const w = await world();
    const state = await w.begin();
    const res = await w.callback(w.okQuery(state, {}, "other-store.myshopify.com"));
    expect(res.status).toBe(400);
    await untouched(w);
    // and the real shop can still finish
    expect((await w.callback(w.okQuery(state))).status).toBe(302);
  });

  it("will not let business B complete business A's state", async () => {
    const w = await world();
    const state = await w.begin({ shop: SHOP }, w.c1);
    const res = await w.callback(w.okQuery(state), w.c2);
    expect(res.status).toBe(403);
    await untouched(w);
    expect(await w.count("shopify_oauth_pending")).toBe(1); // still A's to use
    expect((await w.callback(w.okQuery(state), w.c1)).status).toBe(302);
    expect(((await w.t.db.prepare("select merchant_id from shopify_connections").first()) as any).merchant_id).toBe("m_1");
  });

  it("sends a signed-out browser back to the wizard with a plain reason and calls nothing", async () => {
    const w = await world();
    const res = await w.callback(w.okQuery(await w.begin()), null);
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`${APP_IMPORT}?shopify_error=signed_out`);
    await untouched(w);
  });

  it.each(["evil.com", "demo.myshopify.com.evil.com", "127.0.0.1", "a.b.myshopify.com", "demo.myshopify.com:8080", "demo.myshopify.com/x", ""])("refuses the shop %j even when correctly signed", async (shop) => {
    const w = await world();
    const state = await w.begin();
    const res = await w.callback(w.okQuery(state, {}, shop));
    expect(res.status).toBe(400);
    await untouched(w);
  });

  it("answers 503 when the app is not configured", async () => {
    const w = await world({}, {});
    expect((await w.callback(w.okQuery("a".repeat(64)))).status).toBe(503);
  });

  it.each([
    ["Shopify error", () => Response.json({ error: "invalid_request" }, { status: 400 })],
    ["server error", () => new Response("boom", { status: 500 })],
    ["a redirect (never followed)", () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } })],
    ["not JSON", () => new Response("<html>", { status: 200 })],
    ["no token", () => Response.json({ scope: "read_products" })],
    ["a non-string token", () => Response.json({ access_token: 12345678901234567890 })],
    ["an odd-looking token", () => Response.json({ access_token: "has spaces and ? chars" })],
    ["a network failure", () => new Error("connect ECONNRESET")],
  ])("a failed exchange (%s) leaves no connection and redirects to a fixed address", async (_n, exchange) => {
    const w = await world({ exchange });
    const res = await w.callback(w.okQuery(await w.begin()));
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`${APP_IMPORT}?shopify_error=exchange_failed`);
    expect(await w.count("shopify_connections")).toBe(0);
    expect(await w.count("shopify_oauth_pending")).toBe(0);
    expect(w.s.graphql()).toHaveLength(0);
  });

  it("does not echo whatever Shopify said when it fails", async () => {
    const w = await world({ exchange: () => Response.json({ error: "SECRET-DETAIL", access_token: TOKEN }, { status: 500 }) });
    const res = await w.callback(w.okQuery(await w.begin()));
    expect(location(res)).not.toContain("SECRET-DETAIL");
    expect(await w.everything()).not.toContain(TOKEN);
  });

  it("leaves no connection when the preview fails, and says why in a fixed set of words", async () => {
    const w = await world({ graphqlStatus: 403 });
    const res = await w.callback(w.okQuery(await w.begin()));
    expect(location(res)).toBe(`${APP_IMPORT}?shopify_error=shopify_denied`);
    expect(await w.count("shopify_connections")).toBe(0);
    expect(await w.everything()).not.toContain(TOKEN);
  });

  it("refuses a grant that lacks a permission we asked for", async () => {
    const w = await world({ scope: "read_products" });
    const res = await w.callback(w.okQuery(await w.begin({ shop: SHOP, includeCustomers: true })));
    expect(location(res)).toBe(`${APP_IMPORT}?shopify_error=scope_missing`);
    expect(await w.count("shopify_connections")).toBe(0);
    expect(w.s.graphql()).toHaveLength(0);
  });
});

