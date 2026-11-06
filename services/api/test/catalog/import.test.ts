import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { seedMerchant, setup } from "../helpers/app";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "../fixtures/shopify", name), "utf8");
const files = { products: fx("products_export.csv"), customers: fx("customers_export.csv"), orders: fx("orders_export.csv") };
const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");

type T = ReturnType<typeof setup>;
const send = (t: T, key: string, path: string, body: unknown) => t.req(path, { method: "POST", key, body: JSON.stringify(body) });
const count = async (t: T, table: string, merchant?: string) =>
  ((await t.db.prepare(`select count(*) as n from ${table}${merchant ? " where merchant_id = ?" : ""}`).bind(...(merchant ? [merchant] : [])).first()) as { n: number }).n;

async function world(extra: Parameters<typeof setup>[2] = {}) {
  const t = setup({}, {}, extra);
  const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
  const b = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  return { t, a, b };
}
const csv = (over: object = {}) => ({ source: "csv", currency: "USD", files: { products: files.products }, ...over });

describe("POST /v1/import/shopify/preview", () => {
  it("returns a plain report and writes nothing", async () => {
    const { t, a } = await world();
    const res = await send(t, a, "/v1/import/shopify/preview", csv());
    expect(res.status).toBe(200);
    const { report } = (await res.json()) as any;
    expect(report.counts).toMatchObject({ products: 5, variants: 7, collections: 0, customers: 0, orders: 0 });
    expect(report.plan).toEqual({ productsToCreate: 5, productsToUpdate: 0, productsSkipped: 0 });
    expect(report.currency).toBe("USD");
    const codes = report.warnings.map((w: any) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["gift_card", "subscription_tag", "bad_price", "formula_text"]));
    expect(report.unsupported.join(" ")).toMatch(/Discount codes/);
    expect(report.unsupported.join(" ")).toMatch(/passwords/);
    for (const table of ["products", "variants", "product_images", "imported_customers", "imported_orders"]) expect(await count(t, table)).toBe(0);
  });

  it("requires a key", async () => {
    const { t } = await world();
    expect((await t.req("/v1/import/shopify/preview", { method: "POST", body: JSON.stringify(csv()) })).status).toBe(401);
  });

  it("does not read customers or orders unless includeCustomers is true", async () => {
    const { t, a } = await world();
    const broken = { products: files.products, customers: "this is not a customers file", orders: "nor is this" };
    const off = await send(t, a, "/v1/import/shopify/preview", csv({ files: broken }));
    expect(off.status).toBe(200);
    const r = ((await off.json()) as any).report;
    expect(r.counts.customers).toBe(0);
    expect(r.warnings.map((w: any) => w.code)).toContain("customers_not_included");
    const on = await send(t, a, "/v1/import/shopify/preview", csv({ files: broken, includeCustomers: true }));
    expect(on.status).toBe(400);
    expect(((await on.json()) as any).error.code).toBe("wrong_file");
    const ok = await send(t, a, "/v1/import/shopify/preview", csv({ files, includeCustomers: true }));
    expect(((await ok.json()) as any).report.counts).toMatchObject({ customers: 3, orders: 2 });
  });

  it("never puts customer names, emails or tokens in the report", async () => {
    const { t, a } = await world();
    const text = await (await send(t, a, "/v1/import/shopify/preview", csv({ files, includeCustomers: true }))).text();
    for (const pii of ["ada@example.test", "Ada", "Example", "O'Neil", "bob@"]) expect(text).not.toContain(pii);
  });

  it("asks for a rate instead of guessing one", async () => {
    const { t, a } = await world();
    const res = await send(t, a, "/v1/import/shopify/preview", csv({ currency: "EUR" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("needs_rate");
    const noCurrency = await send(t, a, "/v1/import/shopify/preview", { source: "csv", files: { products: files.products } });
    expect(((await noCurrency.json()) as any).error.code).toBe("needs_currency");
    for (const rate of ["0", "abc", "-1", "1.123456789", "1e3"]) {
      const bad = await send(t, a, "/v1/import/shopify/preview", csv({ currency: "EUR", rate }));
      expect([400, 422]).toContain(bad.status);
    }
  });

  it("rejects bad input shapes", async () => {
    const { t, a } = await world();
    for (const body of [{}, { source: "ftp" }, csv({ surprise: 1 }), { source: "csv", currency: "USD", files: {} }, csv({ files: { products: 5 } })]) {
      expect((await send(t, a, "/v1/import/shopify/preview", body)).status).toBe(400);
    }
  });
});

describe("POST /v1/import/shopify/commit", () => {
  it("needs confirm: true", async () => {
    const { t, a } = await world();
    for (const confirm of [undefined, false]) {
      const res = await send(t, a, "/v1/import/shopify/commit", csv({ ...(confirm === undefined ? {} : { confirm }) }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("confirm_required");
    }
    expect(await count(t, "products")).toBe(0);
  });

  it("writes the catalogue: sanitised, priced, tracked, and visible through the normal API", async () => {
    const { t, a } = await world();
    const res = await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result).toEqual({ created: 5, updated: 0, skipped: 0 });
    const list = (await (await t.req("/v1/products?limit=50", { key: a })).json()) as any;
    const shirt = list.data.find((p: any) => p.handle === "linen-shirt");
    expect(shirt.descriptionHtml).toBe("<p>Soft, breathable <b>linen</b>.</p>");
    expect(shirt.variants.map((v: any) => [v.sku, v.price, v.inventory, v.trackInventory])).toEqual([
      ["SH-S-BL", "1234.5", 5, true],
      ["SH-M-BL", "1234.5", 0, true],
      ["SH-L-BL", "1234.5", 12, true],
    ]);
    expect(shirt.images).toHaveLength(3);
    expect(list.data.find((p: any) => p.handle === "mug").variants[0]).toMatchObject({ price: "12.5", trackInventory: false });
    expect(list.data.find((p: any) => p.handle === "secret-draft").status).toBe("draft");
    const audit = await t.db.prepare("select payload from audit_log where action = 'import.shopify.committed'").first<{ payload: string }>();
    expect(audit!.payload).not.toMatch(/@|shpat/);
  });

  it("converts with the rate the merchant gave, rounding half up to the smallest unit", async () => {
    const { t, a } = await world();
    await send(t, a, "/v1/import/shopify/commit", csv({ currency: "EUR", rate: "1.0853", confirm: true }));
    const mug = ((await (await t.req("/v1/products?limit=50", { key: a })).json()) as any).data.find((p: any) => p.handle === "mug");
    expect(mug.variants[0].price).toBe("13.56625"); // 12.50 x 1.0853
    await send(t, a, "/v1/import/shopify/commit", csv({ currency: "EUR", rate: "1.00000004", confirm: true }));
    const again = ((await (await t.req("/v1/products?limit=50", { key: a })).json()) as any).data.find((p: any) => p.handle === "mug");
    expect(again.variants[0].price).toBe("12.500001"); // 12.5000005 rounds half up
  });

  it("is idempotent: a second run updates the same rows and adds none", async () => {
    const { t, a } = await world();
    const body = csv({ files, includeCustomers: true, confirm: true });
    await send(t, a, "/v1/import/shopify/commit", body);
    const before = { p: await count(t, "products"), v: await count(t, "variants"), i: await count(t, "product_images"), c: await count(t, "imported_customers"), o: await count(t, "imported_orders") };
    const ids = (await t.db.prepare("select id from products order by id").all()).results;
    const again = await send(t, a, "/v1/import/shopify/commit", body);
    expect(((await again.json()) as any).result).toEqual({ created: 0, updated: 5, skipped: 0 });
    expect({ p: await count(t, "products"), v: await count(t, "variants"), i: await count(t, "product_images"), c: await count(t, "imported_customers"), o: await count(t, "imported_orders") }).toEqual(before);
    expect((await t.db.prepare("select id from products order by id").all()).results).toEqual(ids);
    expect(before).toMatchObject({ p: 5, c: 3, o: 2 });
  });

  it("re-importing updates changed prices and stock", async () => {
    const { t, a } = await world();
    await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true }));
    const changed = files.products.replace("12.50", "14.00").replace(",shopify,5,", ",shopify,9,");
    await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true, files: { products: changed } }));
    const list = (await (await t.req("/v1/products?limit=50", { key: a })).json()) as any;
    expect(list.data.find((p: any) => p.handle === "mug").variants[0].price).toBe("14");
    expect(list.data.find((p: any) => p.handle === "linen-shirt").variants[0].inventory).toBe(9);
  });

  it("skips a product whose address is already used by one the business made by hand", async () => {
    const { t, a } = await world();
    await t.req("/v1/products", { method: "POST", key: a, body: JSON.stringify({ title: "My Mug", handle: "mug", variants: [{ price: "99", inventory: 1 }] }) });
    const res = await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true }));
    expect(((await res.json()) as any).result).toEqual({ created: 4, updated: 0, skipped: 1 });
    const mine = ((await (await t.req("/v1/products?limit=50", { key: a })).json()) as any).data.find((p: any) => p.handle === "mug");
    expect(mine.title).toBe("My Mug");
    expect(mine.variants[0].price).toBe("99");
  });

  it("keeps businesses apart: the same file imported by two gives each its own rows", async () => {
    const { t, a, b } = await world();
    await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true, files, includeCustomers: true }));
    await send(t, b, "/v1/import/shopify/commit", csv({ confirm: true, files, includeCustomers: true }));
    for (const table of ["products", "variants", "imported_customers", "imported_orders"]) expect(await count(t, table, "m_1")).toBe(await count(t, table, "m_2"));
    expect(await count(t, "products")).toBe(10);
    const ids = (await t.db.prepare("select id from products").all()).results.map((r: any) => r.id);
    expect(new Set(ids).size).toBe(10);
    const bList = ((await (await t.req("/v1/products?limit=50", { key: b })).json()) as any).data;
    expect(bList).toHaveLength(5);
    const prod = (await t.db.prepare("select id from products where merchant_id = 'm_1' limit 1").first()) as { id: string };
    expect((await t.req(`/v1/products/${prod.id}`, { key: b })).status).toBe(404);
  });

  it("stores only the minimum customer and order fields", async () => {
    const { t, a } = await world();
    await send(t, a, "/v1/import/shopify/commit", csv({ confirm: true, files, includeCustomers: true }));
    const dump = JSON.stringify([(await t.db.prepare("select * from imported_customers").all()).results, (await t.db.prepare("select * from imported_orders").all()).results]);
    for (const secret of ["Test Street", "+44", "VIP", "AB1 2CD", "call me", "SAVE10", "Ada Example"]) expect(dump).not.toContain(secret);
    expect(await count(t, "imported_customers")).toBe(3);
  });

  it("refuses huge files with a clear message", async () => {
    const { t, a } = await world();
    const rows = Array.from({ length: 50_001 }, (_, i) => `h${i},T,,,,,,TRUE,,,,,,,,,,,,,1.00,,,,,,,,,,,active`).join("\n");
    const header = files.products.split("\n")[0];
    const res = await send(t, a, "/v1/import/shopify/preview", csv({ files: { products: `${header}\n${rows}` } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("too_many_rows");
  });
});

describe("Shopify Admin API route", () => {
  const cost = { cost: { requestedQueryCost: 50, actualQueryCost: 10, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 50 } } };
  function shopify(log: { auth: (string | null)[]; urls: string[] }) {
    return (async (url: string, init: RequestInit) => {
      log.urls.push(url);
      log.auth.push(new Headers(init.headers).get("x-shopify-access-token"));
      const op = /query\s+(\w+)/.exec(JSON.parse(init.body as string).query)![1];
      const data =
        op === "Shop" ? { shop: { currencyCode: "USD" } }
        : op === "Products" ? { products: { pageInfo: { hasNextPage: false }, nodes: [{ handle: "tee", title: "Tee", descriptionHtml: "<p>ok</p><script>x</script>", vendor: "V", productType: "T", tags: [], status: "ACTIVE", variants: { pageInfo: { hasNextPage: false }, nodes: [{ sku: "T1", title: "Default Title", price: "20.00", selectedOptions: [], inventoryQuantity: 3, inventoryItem: { tracked: true } }] }, media: { nodes: [] }, collections: { nodes: [{ handle: "summer", title: "Summer" }] } }] } }
        : op === "Customers" ? { customers: { pageInfo: { hasNextPage: false }, nodes: [{ email: "c@example.test", firstName: "C", lastName: "D", defaultAddress: null, emailMarketingConsent: null }] } }
        : { orders: { pageInfo: { hasNextPage: false }, nodes: [] } };
      return new Response(JSON.stringify({ data, extensions: cost }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
  }

  it("previews and commits through the API, with the store's own currency", async () => {
    const log = { auth: [] as (string | null)[], urls: [] as string[] };
    const { t, a } = await world({ fetch: shopify(log) });
    const body = { source: "api", shop: "demo.myshopify.com", token: TOKEN };
    const prev = (await (await send(t, a, "/v1/import/shopify/preview", body)).json()) as any;
    expect(prev.report).toMatchObject({ source: "api", currency: "USD", counts: { products: 1, variants: 1, collections: 1, customers: 0 } });
    expect(await count(t, "products")).toBe(0);
    const done = await send(t, a, "/v1/import/shopify/commit", { ...body, confirm: true, includeCustomers: true });
    expect(done.status).toBe(200);
    expect(await count(t, "products")).toBe(1);
    expect(await count(t, "collections")).toBe(1);
    expect(await count(t, "product_collections")).toBe(1);
    expect(await count(t, "imported_customers")).toBe(1);
    expect(new Set(log.auth)).toEqual(new Set([TOKEN]));
  });

  it("refuses a shop address that is not myshopify.com, without calling out", async () => {
    const log = { auth: [] as (string | null)[], urls: [] as string[] };
    const { t, a } = await world({ fetch: shopify(log) });
    for (const shop of ["evil.com", "demo.myshopify.com.evil.com", "169.254.169.254", "demo.myshopify.com@evil.com", "localhost:8787"]) {
      const res = await send(t, a, "/v1/import/shopify/preview", { source: "api", shop, token: TOKEN });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("bad_shop");
    }
    expect(log.urls).toEqual([]);
  });

  it("never stores, logs or returns the token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const log = { auth: [] as (string | null)[], urls: [] as string[] };
    const { t, a } = await world({ fetch: shopify(log) });
    const responses: string[] = [];
    for (const path of ["preview", "commit"]) {
      const r = await send(t, a, `/v1/import/shopify/${path}`, { source: "api", shop: "demo.myshopify.com", token: TOKEN, includeCustomers: true, confirm: true });
      responses.push(await r.text());
    }
    const bad = await send(t, a, "/v1/import/shopify/preview", { source: "api", shop: "evil.com", token: TOKEN });
    responses.push(await bad.text());
    const wrongShape = await send(t, a, "/v1/import/shopify/preview", { source: "api", shop: "demo.myshopify.com", token: TOKEN, surprise: 1 });
    responses.push(await wrongShape.text());
    // every table, every row
    const tables = (await t.db.prepare("select name from sqlite_master where type = 'table'").all()).results.map((r: any) => r.name as string);
    let everything = "";
    for (const name of tables) everything += JSON.stringify((await t.db.prepare(`select * from "${name}"`).all()).results);
    expect(everything).not.toContain(TOKEN);
    expect(responses.join("\n")).not.toContain(TOKEN);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
      spy.mockRestore();
    }
  });

  it("turns a Shopify refusal into a plain error", async () => {
    const denied = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const { t, a } = await world({ fetch: denied });
    const res = await send(t, a, "/v1/import/shopify/preview", { source: "api", shop: "demo.myshopify.com", token: TOKEN });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("shopify_denied");
  });
});
