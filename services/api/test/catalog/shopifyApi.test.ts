import { describe, expect, it, vi } from "vitest";
import { fetchShopify, isShopDomain } from "../../src/import/shopify/graphql";
import { ImportError } from "../../src/import/shopify/types";

const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");
const SHOP = "demo-store.myshopify.com";

const cost = (available: number, requested = 100) => ({ cost: { requestedQueryCost: requested, actualQueryCost: 20, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: available, restoreRate: 50 } } });
const product = (n: number) => ({
  handle: `item-${n}`,
  title: `Item ${n}`,
  descriptionHtml: "<p>d</p>",
  vendor: "V",
  productType: "T",
  tags: ["a"],
  status: "ACTIVE",
  variants: { pageInfo: { hasNextPage: false }, nodes: [{ sku: `S${n}`, title: "Default Title", price: "10.00", selectedOptions: [{ name: "Title", value: "Default Title" }], inventoryQuantity: 4, inventoryItem: { tracked: true } }] },
  media: { nodes: [{ image: { url: `https://cdn.example/${n}.jpg`, altText: "a" } }, {}] },
  collections: { nodes: [{ handle: "all", title: "All" }] },
});

type Handler = (op: string, vars: Record<string, unknown>, call: number) => { status?: number; headers?: Record<string, string>; body?: unknown } | Error;
function server(handler: Handler) {
  const calls: { url: string; init: RequestInit; op: string; vars: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(init.body as string);
    const op = /query\s+(\w+)/.exec(query)![1]!;
    calls.push({ url, init, op, vars: variables ?? {} });
    const out = handler(op, variables ?? {}, calls.length);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const shopData = { data: { shop: { currencyCode: "EUR" } }, extensions: cost(1000, 1) };
function catalog(pages: number): Handler {
  return (op, vars) => {
    if (op === "Shop") return { body: shopData };
    if (op === "Products") {
      const page = vars.after ? Number(vars.after) : 0;
      return { body: { data: { products: { pageInfo: { hasNextPage: page + 1 < pages, endCursor: String(page + 1) }, nodes: [product(page * 2 + 1), product(page * 2 + 2)] } }, extensions: cost(900) } };
    }
    if (op === "Customers") return { body: { data: { customers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ email: "Ada@Example.test", firstName: "Ada", lastName: "E", defaultAddress: { countryCodeV2: "GB" }, emailMarketingConsent: { marketingState: "SUBSCRIBED" } }] } }, extensions: cost(900) } };
    if (op === "Orders") return { body: { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: "#1001", email: "ada@example.test", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", createdAt: "2026-10-01T10:00:00Z", totalPriceSet: { shopMoney: { amount: "105.00", currencyCode: "EUR" } }, lineItems: { nodes: [{ id: "1" }, { id: "2" }] } }] } }, extensions: cost(900) } };
    throw new Error(`unexpected ${op}`);
  };
}
const run = (s: ReturnType<typeof server>, over: Partial<Parameters<typeof fetchShopify>[0]> = {}) =>
  fetchShopify({ shop: SHOP, token: TOKEN, fetch: s.fetch, sleep: async () => {}, ...over });

describe("isShopDomain", () => {
  it.each(["demo-store.myshopify.com", "a.myshopify.com", "a1-b2.myshopify.com"])("accepts %s", (d) => expect(isShopDomain(d)).toBe(true));
  it.each([
    "evil.com", "a.myshopify.com.evil.com", "a.myshopify.com/x", "https://a.myshopify.com", "a.myshopify.com:443", "-a.myshopify.com", "A.myshopify.com",
    "x.y.myshopify.com", "127.0.0.1", "a.myshopify.com@evil.com", "a.myshopify.com#", "a.myshopify.com\n", " a.myshopify.com", ".myshopify.com", "localhost", "",
    "a.myshopify.com?x=1", "a%2e.myshopify.com", "a.myshopify.comx",
  ])("rejects %j", (d) => expect(isShopDomain(d)).toBe(false));
});

describe("fetchShopify", () => {
  it("reads every page of products, normalised, with the store currency", async () => {
    const s = server(catalog(3));
    const src = await run(s);
    expect(src.currency).toBe("EUR");
    expect(src.products.map((p) => p.handle)).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]);
    expect(src.products[0]).toMatchObject({ title: "Item 1", status: "active", tags: ["a"], collections: ["all"], images: [{ url: "https://cdn.example/1.jpg", alt: "a", position: 1 }] });
    expect(src.products[0]!.variants[0]).toEqual({ key: "item-1:S1", sku: "S1", title: "", options: {}, price: "10.00", inventory: 4, tracked: true });
    expect(src.collections).toEqual([{ handle: "all", title: "All" }]);
    expect(src.customers).toEqual([]);
    expect(src.orders).toEqual([]);
    expect(s.calls.filter((c) => c.op === "Products")).toHaveLength(3);
  });

  it("reads customers and orders only when asked", async () => {
    const without = server(catalog(1));
    await run(without);
    expect(without.calls.map((c) => c.op)).not.toContain("Customers");
    expect(without.calls.map((c) => c.op)).not.toContain("Orders");
    const withAll = server(catalog(1));
    const src = await run(withAll, { include: { customers: true, orders: true } });
    expect(src.customers).toEqual([{ email: "ada@example.test", firstName: "Ada", lastName: "E", country: "GB", acceptsMarketing: true }]);
    expect(src.orders[0]).toMatchObject({ name: "#1001", total: "105.00", currency: "EUR", financialStatus: "paid", lineCount: 2 });
    expect(src.warnings.list().map((w) => w.code)).toContain("orders_window");
  });

  it("only ever sends read queries, to the shop's own admin endpoint, with the token in the header", async () => {
    const s = server(catalog(1));
    await run(s, { include: { customers: true, orders: true } });
    for (const c of s.calls) {
      expect(c.url).toBe(`https://${SHOP}/admin/api/2026-07/graphql.json`);
      expect(JSON.parse(c.init.body as string).query).not.toMatch(/mutation/i);
      expect((c.init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(TOKEN);
      expect(c.init.method).toBe("POST");
      expect(c.init.redirect).toBe("manual");
      expect(c.init.body as string).not.toContain(TOKEN);
      expect(c.url).not.toContain(TOKEN);
    }
  });

  it("waits for Shopify's cost bucket to refill before the next request", async () => {
    const sleeps: number[] = [];
    const s = server((op, vars) => {
      if (op === "Shop") return { body: shopData };
      const page = vars.after ? Number(vars.after) : 0;
      // first page leaves only 20 points; the next query needs about 100 at 50 points a second -> wait 1.6 s
      return { body: { data: { products: { pageInfo: { hasNextPage: page === 0, endCursor: "1" }, nodes: [product(page + 1)] } }, extensions: { cost: { requestedQueryCost: 100, actualQueryCost: 80, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: page === 0 ? 20 : 900, restoreRate: 50 } } } } };
    });
    await run(s, { sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([1600]);
  });

  it("does not wait when there is plenty of budget", async () => {
    const sleeps: number[] = [];
    await run(server(catalog(3)), { sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([]);
  });

  it("retries once Shopify says THROTTLED, after waiting", async () => {
    const sleeps: number[] = [];
    let thrown = false;
    const base = catalog(1);
    const s = server((op, vars, n) => {
      if (op === "Products" && !thrown) {
        thrown = true;
        return { body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: cost(0, 300) } };
      }
      return base(op, vars, n);
    });
    const src = await run(s, { sleep: async (ms) => void sleeps.push(ms) });
    expect(src.products).toHaveLength(2);
    expect(sleeps).toEqual([6000]); // 300 points / 50 per second
  });

  it("honours Retry-After on HTTP 429", async () => {
    const sleeps: number[] = [];
    let hit = false;
    const base = catalog(1);
    const s = server((op, vars, n) => {
      if (op === "Shop" && !hit) {
        hit = true;
        return { status: 429, headers: { "retry-after": "3" } };
      }
      return base(op, vars, n);
    });
    await run(s, { sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after too many throttles instead of looping", async () => {
    const s = server((op) => (op === "Shop" ? { body: shopData } : { body: { errors: [{ message: "t", extensions: { code: "THROTTLED" } }], extensions: cost(0, 100) } }));
    await expect(run(s)).rejects.toMatchObject({ code: "shopify_throttled" });
  });

  it("stops at the request cap and says the result is partial", async () => {
    const s = server(catalog(500));
    const src = await run(s, { maxRequests: 5 });
    expect(src.products.length).toBeLessThan(500 * 2);
    expect(src.warnings.list().map((w) => w.code)).toContain("truncated");
    expect(s.calls.length).toBeLessThanOrEqual(5);
  });

  it("rejects a bad domain before any request", async () => {
    const s = server(catalog(1));
    for (const shop of ["evil.com", "a.myshopify.com.evil.com", "169.254.169.254", "a.myshopify.com@evil.com"]) {
      await expect(run(s, { shop })).rejects.toMatchObject({ code: "bad_shop" });
    }
    expect(s.calls).toHaveLength(0);
  });

  it("rejects a malformed token before any request", async () => {
    const s = server(catalog(1));
    for (const token of ["", "short", "has space in it 0123456789", "line\nbreak0123456789abcd"]) {
      await expect(run(s, { token })).rejects.toMatchObject({ code: "bad_token" });
    }
    expect(s.calls).toHaveLength(0);
  });

  it("does not follow redirects", async () => {
    const s = server(() => ({ status: 302, headers: { location: "http://169.254.169.254/" } }));
    await expect(run(s)).rejects.toMatchObject({ code: "shopify_redirect" });
    expect(s.calls).toHaveLength(1);
  });

  it("explains a refused token and a missing scope", async () => {
    await expect(run(server(() => ({ status: 401 })))).rejects.toMatchObject({ code: "shopify_denied" });
    const base = catalog(1);
    const noScope = server((op, vars, n) => (op === "Products" ? { body: { errors: [{ message: "Access denied for products field. Required access: `read_products` access scope." }] } } : base(op, vars, n)));
    await expect(run(noScope)).rejects.toMatchObject({ code: "missing_scope" });
  });

  it("never leaks the token in errors, warnings or logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const messages: string[] = [];
    const attempts: Handler[] = [
      () => new Error(`socket hang up to ${SHOP} with ${TOKEN}`),
      () => ({ status: 401, body: { errors: `bad token ${TOKEN}` } }),
      () => ({ status: 500, body: { errors: TOKEN } }),
      () => ({ status: 200, body: { errors: [{ message: `weird ${TOKEN}` }] } }),
      () => ({ status: 200, body: `not json ${TOKEN}` }),
    ];
    for (const h of attempts) {
      try {
        await run(server(h));
        messages.push("no error");
      } catch (e) {
        expect(e).toBeInstanceOf(ImportError);
        messages.push(`${(e as ImportError).code} ${(e as Error).message} ${JSON.stringify(e)} ${(e as Error).stack ?? ""}`);
      }
    }
    const okRun = server(catalog(1));
    const src = await run(okRun, { include: { customers: true, orders: true } });
    messages.push(JSON.stringify(src), JSON.stringify(src.warnings.list()));
    expect(messages.join("\n")).not.toContain(TOKEN);
    expect(messages.join("\n")).not.toContain("0123456789abcdef");
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
      spy.mockRestore();
    }
  });

  it("warns when a product has more variants than one page", async () => {
    const base = catalog(1);
    const s = server((op, vars, n) => {
      const r = base(op, vars, n);
      if (op === "Products" && !(r instanceof Error)) {
        const body = r.body as any;
        body.data.products.nodes[0].variants.pageInfo.hasNextPage = true;
      }
      return r;
    });
    const src = await run(s);
    expect(src.warnings.list().map((w) => w.code)).toContain("variants_truncated");
  });
});
