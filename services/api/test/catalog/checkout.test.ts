import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "../helpers/app";

type T = ReturnType<typeof setup>;
const post = (t: T, key: string, path: string, body: unknown, idem: string = crypto.randomUUID()) =>
  t.req(path, { method: "POST", key, idem, body: JSON.stringify(body) });
const json = (t: T, key: string, method: string, path: string, body?: unknown) =>
  t.req(path, { method, key, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function shop(opts: { inventory?: number; trackInventory?: boolean } = {}) {
  const t = setup();
  const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
  const b = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const mk = async (key: string, title: string, price: string, inventory: number, extra: object = {}) =>
    ((await (await json(t, key, "POST", "/v1/products", { title, status: "active", variants: [{ price, inventory, trackInventory: opts.trackInventory ?? true }], ...extra })).json()) as any).variants[0].id as string;
  const mug = await mk(a, "Mug", "12.50", opts.inventory ?? 5);
  const cap = await mk(a, "Cap", "8", 2);
  const draft = await mk(a, "Draft", "3", 9, { status: "draft" });
  const foreign = await mk(b, "Foreign", "1", 9);
  const stock = async (id: string) => ((await t.db.prepare("select inventory from variants where id = ?").bind(id).first()) as { inventory: number }).inventory;
  return { t, a, b, mug, cap, draft, foreign, stock };
}

describe("POST /v1/store/checkout", () => {
  it("prices the cart on the server, creates the invoice and holds the stock", async () => {
    const { t, a, mug, cap, stock } = await shop();
    const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 2 }, { variantId: cap, quantity: 1 }], customerEmail: "buyer@example.com" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.total).toBe("33");
    expect(body.lines).toEqual([
      { variantId: mug, title: "Mug", quantity: 2, unitPrice: "12.5" },
      { variantId: cap, title: "Cap", quantity: 1, unitPrice: "8" },
    ]);
    expect(body.invoice).toMatchObject({ amount: "33", status: "open", metadata: { order: body.orderId, source: "stenmont-store" } });
    expect((t.chain.calls[0] as { amount: bigint }).amount).toBe(33_000_000n);
    expect(await stock(mug)).toBe(3);
    expect(await stock(cap)).toBe(1);
  });

  it("merges repeated lines for one variant", async () => {
    const { t, a, mug, stock } = await shop();
    const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }, { variantId: mug, quantity: 2 }] });
    expect(((await res.json()) as any).total).toBe("37.5");
    expect(await stock(mug)).toBe(2);
  });

  it("refuses client-supplied prices, totals and malformed carts", async () => {
    const { t, a, mug } = await shop();
    const bad = [
      { items: [{ variantId: mug, quantity: 1, price: "0.01" }] },
      { items: [{ variantId: mug, quantity: 1 }], amount: "0.01" },
      { items: [{ variantId: mug, quantity: 0 }] },
      { items: [{ variantId: mug, quantity: -1 }] },
      { items: [{ variantId: mug, quantity: 1.5 }] },
      { items: [{ variantId: mug, quantity: 1001 }] },
      { items: [{ variantId: mug, quantity: "1" }] },
      { items: [] },
      { items: Array.from({ length: 51 }, () => ({ variantId: mug, quantity: 1 })) },
      { items: [{ variantId: mug, quantity: 1 }], successUrl: "javascript:alert(1)" },
    ];
    for (const b of bad) expect((await post(t, a, "/v1/store/checkout", b)).status).toBe(400);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("does not sell variants of another business, drafts or unknown variants", async () => {
    const { t, a, draft, foreign, stock } = await shop();
    for (const id of [draft, foreign, "var_nope"]) {
      const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: id, quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).error.code).toBe("variant_unavailable");
    }
    expect(await stock(foreign)).toBe(9);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("refuses totals above the cap without touching stock", async () => {
    const t = setup();
    const a = await seedMerchant(t.db);
    const v = ((await (await json(t, a, "POST", "/v1/products", { title: "Yacht", status: "active", variants: [{ price: "10000000", inventory: 1000, trackInventory: true }] })).json()) as any).variants[0].id;
    const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: v, quantity: 11 }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("order_too_large");
    expect(((await t.db.prepare("select inventory from variants where id = ?").bind(v).first()) as any).inventory).toBe(1000);
  });

  it("refuses when there is not enough stock and leaves every line untouched", async () => {
    const { t, a, mug, cap, stock } = await shop();
    const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 2 }, { variantId: cap, quantity: 3 }] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toMatchObject({ code: "out_of_stock", details: { variantId: cap } });
    expect(await stock(mug)).toBe(5);
    expect(await stock(cap)).toBe(2);
    expect(t.chain.calls).toHaveLength(0);
  });

  it("sells the last unit to only one of two simultaneous buyers", async () => {
    const { t, a, mug, stock } = await shop({ inventory: 1 });
    const results = await Promise.all([1, 2, 3, 4].map(() => post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await stock(mug)).toBe(0);
    expect(t.chain.calls).toHaveLength(1);
  });

  it("does not count variants that are not tracked", async () => {
    const { t, a, mug, stock } = await shop({ inventory: 0, trackInventory: false });
    expect((await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 7 }] })).status).toBe(201);
    expect(await stock(mug)).toBe(0);
  });

  it("puts the stock back when the invoice cannot be created", async () => {
    const t = setup({ createInvoice: async () => { throw new Error("rpc down"); } });
    const a = await seedMerchant(t.db);
    const mug = ((await (await json(t, a, "POST", "/v1/products", { title: "Mug", status: "active", variants: [{ price: "5", inventory: 4 }] })).json()) as any).variants[0].id;
    const res = await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 3 }] });
    expect(res.status).toBe(502);
    expect(((await t.db.prepare("select inventory from variants where id = ?").bind(mug).first()) as any).inventory).toBe(4);
    expect(((await t.db.prepare("select status from store_orders").first()) as any).status).toBe("failed");
  });

  it("is idempotent: a replay returns the same order and takes stock once", async () => {
    const { t, a, mug, stock } = await shop();
    const body = { items: [{ variantId: mug, quantity: 2 }] };
    const first = (await (await post(t, a, "/v1/store/checkout", body, "same")).json()) as any;
    const again = (await (await post(t, a, "/v1/store/checkout", body, "same")).json()) as any;
    expect(again.orderId).toBe(first.orderId);
    expect(await stock(mug)).toBe(3);
    expect(t.chain.calls).toHaveLength(1);
  });

  it("requires an idempotency key and authentication", async () => {
    const { t, a, mug } = await shop();
    expect((await t.req("/v1/store/checkout", { method: "POST", key: a, body: JSON.stringify({ items: [{ variantId: mug, quantity: 1 }] }) })).status).toBe(400);
    expect((await t.req("/v1/store/checkout", { method: "POST", idem: "k", body: "{}" })).status).toBe(401);
  });

  it("keeps expired reservations while invoices remain payable, and recognizes a late payment", async () => {
    const { t, a, mug, stock } = await shop({ inventory: 2 });
    const unpaid = (await (await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })).json()) as any;
    const paid = (await (await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })).json()) as any;
    expect(await stock(mug)).toBe(0);
    await t.db.prepare("update invoices set status = 'paid' where id = ?").bind(paid.invoice.id).run();
    t.clock.now = new Date(t.clock.now.getTime() + 31 * 60_000);
    const orders = (await (await json(t, a, "GET", "/v1/store/orders")).json()) as any;
    const status = Object.fromEntries(orders.data.map((o: any) => [o.id, o.status]));
    expect(status[unpaid.orderId]).toBe("reserved");
    expect(status[paid.orderId]).toBe("paid");
    expect(await stock(mug)).toBe(0);
    // The original invoice can still be paid: its stock must not have been sold a second time.
    expect((await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })).status).toBe(409);
    await t.db.prepare("update invoices set status = 'paid' where id = ?").bind(unpaid.invoice.id).run();
    const later = (await (await json(t, a, "GET", "/v1/store/orders")).json()) as any;
    expect(later.data.find((o: any) => o.id === unpaid.orderId).status).toBe("paid");
    expect(await stock(mug)).toBe(0);
  });

  it("shows a business only its own orders", async () => {
    const { t, a, b, mug } = await shop();
    await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] });
    expect(((await (await json(t, b, "GET", "/v1/store/orders")).json()) as any).data).toEqual([]);
    expect(((await (await json(t, a, "GET", "/v1/store/orders")).json()) as any).data).toHaveLength(1);
  });
});


describe("authoritative stock release", () => {
  it("releases once only after a confirmed empty unhooked cancellation", async () => {
    const { t, a, mug, stock } = await shop({ inventory: 1 });
    const made = await (await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })).json() as any;
    await t.db.prepare("update invoices set status='cancelled' where id=?").bind(made.invoice.id).run();
    t.clock.now = new Date(t.clock.now.getTime() + 31 * 60_000);
    t.chain.invoiceState = async () => ({ status: 3, paid: 0n, hook: "0x0000000000000000000000000000000000000000" });
    const orders = await (await json(t, a, "GET", "/v1/store/orders")).json() as any;
    expect(orders.data[0].status).toBe("released");
    expect(await stock(mug)).toBe(1);
    await json(t, a, "GET", "/v1/store/orders");
    expect(await stock(mug)).toBe(1);
  });

  it("holds stock for hosted expiry, RPC uncertainty, partial payment, financing and pending relay work", async () => {
    for (const condition of ["hosted", "rpc", "paid", "hook", "pending", "indexed"]) {
      const { t, a, mug, stock } = await shop({ inventory: 1 });
      const made = await (await post(t, a, "/v1/store/checkout", { items: [{ variantId: mug, quantity: 1 }] })).json() as any;
      await t.db.prepare("update invoices set status=? where id=?").bind(condition === "hosted" ? "expired" : "cancelled", made.invoice.id).run();
      t.clock.now = new Date(t.clock.now.getTime() + 31 * 60_000);
      t.chain.invoiceState = async () => {
        if (condition === "rpc") throw new Error("RPC unavailable");
        return { status: condition === "hosted" ? 1 : 3, paid: condition === "paid" ? 1n : 0n, hook: condition === "hook" ? "0x1111111111111111111111111111111111111111" : "0x0000000000000000000000000000000000000000" };
      };
      if (condition === "pending") await t.db.prepare("insert into relayer_txs(id,merchant_id,invoice_id,kind,payer,value,status,idempotency_key,created_at,updated_at) values('hold','m_1',?,'pay','payer','1','sent','hold',?,?)").bind(made.invoice.id,t.clock.now.toISOString(),t.clock.now.toISOString()).run();
      if (condition === "indexed") await t.db.prepare("update invoices set amount_paid='1' where id=?").bind(made.invoice.id).run();
      const orders = await (await json(t, a, "GET", "/v1/store/orders")).json() as any;
      expect(orders.data[0].status, condition).toBe("reserved");
      expect(await stock(mug), condition).toBe(0);
    }
  });
});
