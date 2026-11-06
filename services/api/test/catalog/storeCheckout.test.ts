import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "../helpers/app";

type T = ReturnType<typeof setup>;
const json = (t: T, key: string, method: string, path: string, body?: unknown) =>
  t.req(path, { method, key, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** A shopper: no key, a browser-style Origin, and an IP of their own. */
const buy = (t: T, slug: string, body: unknown, o: { idem?: string | null; ip?: string } = {}) =>
  t.req(`/store/${slug}/checkout`, {
    method: "POST",
    idem: o.idem === null ? "" : (o.idem ?? crypto.randomUUID()),
    headers: { "cf-connecting-ip": o.ip ?? "203.0.113.7", origin: "https://app.test" },
    body: JSON.stringify(body),
  });

async function shop(opts: { inventory?: number; trackInventory?: boolean } = {}) {
  const t = setup();
  const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
  const b = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  await json(t, a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop" });
  await json(t, b, "PUT", "/v1/store", { slug: "other", name: "Other Shop" });
  const mk = async (key: string, title: string, price: string, inventory: number, extra: object = {}) =>
    ((await (await json(t, key, "POST", "/v1/products", { title, status: "active", variants: [{ price, inventory, trackInventory: opts.trackInventory ?? true }], ...extra })).json()) as any).variants[0].id as string;
  const mug = await mk(a, "Mug", "12.50", opts.inventory ?? 5);
  const draft = await mk(a, "Draft", "3", 9, { status: "draft" });
  const foreign = await mk(b, "Foreign", "1", 9);
  const stock = async (id: string) => ((await t.db.prepare("select inventory from variants where id = ?").bind(id).first()) as { inventory: number }).inventory;
  return { t, a, b, mug, draft, foreign, stock };
}

describe("POST /store/:slug/checkout (shoppers, no key)", () => {
  it("prices on the server, holds the stock and returns only a pay address", async () => {
    const { t, mug, stock } = await shop();
    const res = await buy(t, "acme", { items: [{ variantId: mug, quantity: 2 }], customerEmail: "buyer@example.com" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.total).toBe("25");
    expect(body.payUrl).toMatch(/^https:\/\/app\.test\/pay\/0x[0-9a-f]{64}$/);
    expect(Object.keys(body).sort()).toEqual(["invoiceId", "lines", "orderId", "payUrl", "total"]);
    const text = JSON.stringify(body);
    for (const leak of ["m_1", "buyer@example.com", "metadata", "merchantId"]) expect(text).not.toContain(leak);
    expect((t.chain.calls[0] as { amount: bigint }).amount).toBe(25_000_000n);
    expect(await stock(mug)).toBe(3);
    // the shopper comes back to the shop after paying, and to the cart if they back out
    const inv = (await t.db.prepare("select success_url, cancel_url from invoices").first()) as any;
    expect(inv).toEqual({ success_url: "https://app.test/store/acme?thanks=1", cancel_url: "https://app.test/store/acme" });
  });

  it("needs an Idempotency-Key, and a retry with the same key and cart gives the same order once", async () => {
    const { t, mug, stock } = await shop();
    const cart = { items: [{ variantId: mug, quantity: 1 }] };
    const none = await buy(t, "acme", cart, { idem: null });
    expect(none.status).toBe(400);
    expect(((await none.json()) as any).error.code).toBe("idempotency_key_required");
    const first = await buy(t, "acme", cart, { idem: "k-1" });
    const again = await buy(t, "acme", cart, { idem: "k-1" });
    expect(((await again.json()) as any).orderId).toBe(((await first.json()) as any).orderId);
    expect(await stock(mug)).toBe(4);
    expect(t.chain.calls).toHaveLength(1);
    const other = await buy(t, "acme", { items: [{ variantId: mug, quantity: 2 }] }, { idem: "k-1" });
    expect(other.status).toBe(422);
  });

  it("ignores or refuses anything a shopper sends about money", async () => {
    const { t, mug } = await shop();
    const bad = [
      { items: [{ variantId: mug, quantity: 1, price: "0.01" }] },
      { items: [{ variantId: mug, quantity: 1 }], amount: "0.01" },
      { items: [{ variantId: mug, quantity: 1 }], total: "0.01" },
      { items: [{ variantId: mug, quantity: 1 }], successUrl: "https://evil.example" },
      { items: [{ variantId: mug, quantity: 1 }], payTo: "0x1111111111111111111111111111111111111111" },
      { items: [{ variantId: mug, quantity: 0 }] },
      { items: [{ variantId: mug, quantity: -3 }] },
      { items: [{ variantId: mug, quantity: 1.5 }] },
      { items: [{ variantId: mug, quantity: 1001 }] },
      { items: [] },
      { items: [{ variantId: mug, quantity: 1 }], customerEmail: "not-an-email" },
    ];
    for (const [i, b] of bad.entries()) expect((await buy(t, "acme", b, { ip: `203.0.113.${100 + i}` })).status, JSON.stringify(b)).toBe(400);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("sells the last unit to one of two simultaneous shoppers", async () => {
    const { t, mug, stock } = await shop({ inventory: 1 });
    const cart = { items: [{ variantId: mug, quantity: 1 }] };
    const results = await Promise.all([buy(t, "acme", cart, { ip: "198.51.100.1" }), buy(t, "acme", cart, { ip: "198.51.100.2" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stock(mug)).toBe(0);
    expect(t.chain.calls).toHaveLength(1);
  });

  it("does not sell another business's variants, drafts or unknown ids, and keeps stores apart", async () => {
    const { t, draft, foreign, mug, stock } = await shop();
    for (const id of [draft, foreign, "var_nope"]) {
      const res = await buy(t, "acme", { items: [{ variantId: id, quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).error.code).toBe("variant_unavailable");
    }
    expect((await buy(t, "other", { items: [{ variantId: mug, quantity: 1 }] })).status).toBe(422);
    expect((await buy(t, "nope", { items: [{ variantId: mug, quantity: 1 }] })).status).toBe(404);
    expect(await stock(foreign)).toBe(9);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("refuses a business that has paused payments or is not active, without touching stock", async () => {
    const { t, mug, stock } = await shop();
    await t.db.prepare("insert into payment_switch (merchant_id, paused, mode, updated_at) values ('m_1', 1, 'test', ?)").bind(new Date().toISOString()).run();
    const res = await buy(t, "acme", { items: [{ variantId: mug, quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("payments_paused");
    expect(await stock(mug)).toBe(5);
    await t.db.prepare("update payment_switch set paused = 0").run();
    await t.db.prepare("update merchants set status = 'suspended' where id = 'm_1'").run();
    expect((await buy(t, "acme", { items: [{ variantId: mug, quantity: 1 }] })).status).toBe(404);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("limits each IP, then each store, and says so", async () => {
    const { t, mug } = await shop({ trackInventory: false });
    const cart = { items: [{ variantId: mug, quantity: 1 }] };
    for (let i = 0; i < 10; i++) expect((await buy(t, "acme", cart, { ip: "192.0.2.1" })).status).toBe(201);
    const limited = await buy(t, "acme", cart, { ip: "192.0.2.1" });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as any).error.code).toBe("rate_limited");
    expect((await buy(t, "acme", cart, { ip: "192.0.2.2" })).status).toBe(201); // another shopper is not affected
    // many shoppers together cannot exhaust the business's own invoice allowance
    let statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await buy(t, "acme", cart, { ip: `198.18.0.${i + 1}` })).status);
    expect(statuses.filter((s) => s === 201).length).toBeLessThan(30);
    expect(statuses).toContain(429);
    // the business can still create its own invoices with the key
    const own = await t.req("/v1/invoices", { method: "POST", key: `sk_test_${"a".repeat(32)}`, idem: "own-1", body: JSON.stringify({ amount: "1" }) });
    expect(own.status).toBe(201);
  });

  it("lets only our own app call it from a browser, with the idempotency header allowed", async () => {
    const { t } = await shop();
    const pre = await t.req("/store/acme/checkout", { method: "OPTIONS", headers: { origin: "https://app.test", "access-control-request-method": "POST", "access-control-request-headers": "content-type,idempotency-key" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("idempotency-key");
    const evil = await t.req("/store/acme/checkout", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});
