import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src";
import { world } from "./fakes";
import { env, fake, SHOP } from "./helpers";

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
}
const O1 = "gid://shopify/Order/1001";
// A realistic body including personal data that must never be kept.
const payload = (over: any = {}) => ({
  id: 1001,
  admin_graphql_api_id: O1,
  name: "#1001",
  total_price: "25.00",
  currency: "USD",
  financial_status: "pending",
  payment_gateway_names: ["Pay with USDT (Stenmont)"],
  created_at: "2026-11-06T10:00:00+05:30",
  email: "jane.customer@example.com",
  phone: "+15551230000",
  customer: { first_name: "Jane", last_name: "Customer", email: "jane.customer@example.com" },
  billing_address: { address1: "1 Secret Street", city: "Hidden" },
  shipping_address: { address1: "1 Secret Street" },
  ...over,
});
async function hook(app: ReturnType<typeof createApp>, e: ReturnType<typeof env>, topic: string, body: unknown, h: Record<string, string> = {}, secret = fake("shopify_secret")) {
  const raw = JSON.stringify(body);
  return app.request("/webhooks/shopify", { method: "POST", headers: { "x-shopify-hmac-sha256": await sign(secret, raw), "x-shopify-topic": topic, "x-shopify-shop-domain": SHOP, ...h }, body: raw }, e);
}
const auth = { authorization: `Bearer ${fake("bridge_admin")}` };

describe("POST /webhooks/shopify", () => {
  it("refuses a missing, wrong or tampered HMAC and a webhook from another shop", async () => {
    const w = world({ orders: { [O1]: {} } });
    const app = createApp(w.d);
    const e = env();
    const raw = JSON.stringify(payload());
    expect((await app.request("/webhooks/shopify", { method: "POST", body: raw }, e)).status).toBe(401);
    expect((await hook(app, e, "orders/create", payload(), {}, "wrong")).status).toBe(401);
    expect((await app.request("/webhooks/shopify", { method: "POST", headers: { "x-shopify-hmac-sha256": await sign(fake("shopify_secret"), raw), "x-shopify-topic": "orders/create", "x-shopify-shop-domain": SHOP }, body: raw.replace("25.00", "0.01") }, e)).status).toBe(401);
    expect((await hook(app, e, "orders/create", payload(), { "x-shopify-shop-domain": "other.myshopify.com" })).status).toBe(403);
    expect((e.STATE as any).m.size).toBe(0);
    expect(w.calls.length).toBe(0);
  });

  it("mirrors an order without any personal data and creates an invoice for the USDT payment method", async () => {
    const w = world({ orders: { [O1]: { amount: "25.00" } } });
    const app = createApp(w.d);
    const e = env();
    const res = await hook(app, e, "orders/create", payload(), { "x-shopify-webhook-id": "wh1" });
    expect(res.status).toBe(200);
    const stored = (e.STATE as any).m.get("order:1001");
    const m = JSON.parse(stored);
    expect(m).toMatchObject({ id: "1001", name: "#1001", total: "25.00", currency: "USD", status: "pending", stenmont: { invoiceId: "0xinv1", payUrl: "https://app.stenmont.test/pay/0xinv1" } });
    for (const secretish of ["jane", "Jane", "example.com", "Secret", "Hidden", "5551230000"]) expect([...(e.STATE as any).m.values()].join("")).not.toContain(secretish);
    const st = w.calls.find((c) => c.url.includes("api.stenmont.test"))!;
    expect(st.body).toMatchObject({ amount: "25.00", metadata: { shop: SHOP, orderId: O1, shopifyCurrency: "USD" } });
  });

  it("prices the invoice from Shopify, not from the webhook body", async () => {
    const w = world({ orders: { [O1]: { amount: "25.00" } } });
    await hook(createApp(w.d), env(), "orders/create", payload({ total_price: "0.01" }));
    expect(w.calls.find((c) => c.url.includes("api.stenmont.test"))!.body.amount).toBe("25.00");
  });

  it("is safe for replays and out-of-order events: one invoice, and paid never goes back to pending", async () => {
    const w = world({ orders: { [O1]: {} } });
    const app = createApp(w.d);
    const e = env();
    await hook(app, e, "orders/create", payload(), { "x-shopify-webhook-id": "a" });
    const dup = await hook(app, e, "orders/create", payload(), { "x-shopify-webhook-id": "a" });
    expect(((await dup.json()) as any).status).toBe("duplicate");
    await hook(app, e, "orders/create", payload(), { "x-shopify-webhook-id": "b" }); // same order, new delivery
    expect(w.state.created).toBe(1);
    await hook(app, e, "orders/paid", payload({ financial_status: "paid" }), { "x-shopify-webhook-id": "c" });
    await hook(app, e, "orders/create", payload(), { "x-shopify-webhook-id": "d" }); // late, stale
    const m = JSON.parse((e.STATE as any).m.get("order:1001"));
    expect(m.status).toBe("paid");
    expect(m.paidAt).toBeTruthy();
    expect(w.state.created).toBe(1);
  });

  it("handles orders/paid arriving before orders/create", async () => {
    const w = world({ orders: { [O1]: {} } });
    const app = createApp(w.d);
    const e = env();
    await hook(app, e, "orders/paid", payload({ financial_status: "paid" }));
    await hook(app, e, "orders/create", payload());
    expect(JSON.parse((e.STATE as any).m.get("order:1001")).status).toBe("paid");
    expect(w.state.created).toBe(0); // already paid: no invoice needed
  });

  it("does not invoice other payment methods, and does not invoice an order the bridge itself created from a draft", async () => {
    const w = world({ orders: { [O1]: {}, "gid://shopify/Order/1002": {} } });
    const app = createApp(w.d);
    const e = env();
    await hook(app, e, "orders/create", payload({ payment_gateway_names: ["bogus"] }));
    await (e.STATE as any).put("fromdraft:1002", "101");
    await hook(app, e, "orders/create", payload({ id: 1002, admin_graphql_api_id: "gid://shopify/Order/1002" }));
    expect(w.state.created).toBe(0);
  });

  it("records the reason and still answers 200 when the invoice cannot be made (so Shopify keeps the subscription)", async () => {
    const w = world({ orders: { [O1]: { currency: "INR", amount: "500.00" } } });
    const e = env();
    const res = await hook(createApp(w.d), e, "orders/create", payload({ currency: "INR" }));
    expect(res.status).toBe(200);
    expect(JSON.parse((e.STATE as any).m.get("order:1001")).invoiceError).toBe("needs_rate");
  });

  it("ignores other topics", async () => {
    const w = world();
    const res = await hook(createApp(w.d), env(), "orders/updated", payload());
    expect(((await res.json()) as any).status).toBe("ignored");
  });

  it("pays an order made with the USDT method when its Stenmont invoice is paid", async () => {
    const w = world({ orders: { [O1]: {} } });
    const app = createApp(w.d);
    const e = env();
    await hook(app, e, "orders/create", payload());
    const { signWebhook } = await import("@stenmont/sdk");
    const body = JSON.stringify({ id: "evt_o", type: "invoice.paid", created: 1, livemode: false, data: { invoice: { id: "0xinv1", amount: "10.00", metadata: { shop: SHOP, orderId: O1 } }, payment: { txHash: "0x" + "ab".repeat(32) } } });
    const res = await app.request("/webhooks/stenmont", { method: "POST", headers: { "stenmont-signature": await signWebhook(fake("stenmont_whsec"), body) }, body }, e);
    expect(((await res.json()) as any).status).toBe("done");
    expect(w.state.orders.get(O1)!.status).toBe("PAID");
    expect(w.state.orders.get(O1)!.gateway).toBe("Pay with USDT (Stenmont)");
  });
});

describe("GET /orders", () => {
  it("needs the bearer and returns the mirrored feed, newest first", async () => {
    const w = world({ orders: { [O1]: {}, "gid://shopify/Order/1002": {} } });
    const app = createApp(w.d);
    const e = env();
    await hook(app, e, "orders/create", payload({ payment_gateway_names: [] }));
    await hook(app, e, "orders/create", payload({ id: 1002, admin_graphql_api_id: "gid://shopify/Order/1002", name: "#1002", created_at: "2026-11-07T10:00:00Z", payment_gateway_names: [] }));
    expect((await app.request("/orders", {}, e)).status).toBe(401);
    expect((await app.request("/orders", { headers: { authorization: "Bearer wrong" } }, e)).status).toBe(401);
    const res = await app.request("/orders", { headers: auth }, e);
    const j: any = await res.json();
    expect(j.orders.map((o: any) => o.name)).toEqual(["#1002", "#1001"]);
    expect(JSON.stringify(j)).not.toContain("jane");
  });
});

describe("POST /admin/register-webhooks", () => {
  const url = "https://bridge.example.com/admin/register-webhooks";
  it("needs the bearer", async () => {
    const w = world();
    const res = await createApp(w.d).request(url, { method: "POST" }, env());
    expect(res.status).toBe(401);
    expect(w.calls.length).toBe(0);
  });
  it("creates the two subscriptions once and is idempotent", async () => {
    const w = world();
    const app = createApp(w.d);
    const e = env();
    const a: any = await (await app.request(url, { method: "POST", headers: auth }, e)).json();
    expect(a).toEqual({ callback: "https://bridge.example.com/webhooks/shopify", created: ["ORDERS_CREATE", "ORDERS_PAID"], existing: [] });
    const b: any = await (await app.request(url, { method: "POST", headers: auth }, e)).json();
    expect(b).toEqual({ callback: a.callback, created: [], existing: ["ORDERS_CREATE", "ORDERS_PAID"] });
    expect(w.state.ops.filter((o) => o.startsWith("sub:"))).toEqual(["sub:ORDERS_CREATE", "sub:ORDERS_PAID"]);
  });
  it("creates only what is missing and refuses plain http", async () => {
    const w = world({ subs: [{ id: "1", topic: "ORDERS_PAID", uri: "https://bridge.example.com/webhooks/shopify" }] });
    const app = createApp(w.d);
    const out: any = await (await app.request(url, { method: "POST", headers: auth }, env())).json();
    expect(out).toMatchObject({ created: ["ORDERS_CREATE"], existing: ["ORDERS_PAID"] });
    expect((await app.request("http://localhost/admin/register-webhooks", { method: "POST", headers: auth }, env())).status).toBe(422);
  });
});

describe("theme snippet", () => {
  const liquid = readFileSync(new URL("../theme/snippets/stenmont-pay.liquid", import.meta.url), "utf8").replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/, "");
  it("posts only variant ids and quantities from cart.js to the bridge, and redirects only to an https pay link", () => {
    expect(liquid).toContain("cart.js");
    expect(liquid).toContain("/checkout");
    expect(liquid).toMatch(/variantId:\s*i\.variant_id/);
    expect(liquid).toMatch(/quantity:\s*i\.quantity/);
    expect(liquid).not.toMatch(/price|total/i);
    expect(liquid).toContain("https://");
    expect(liquid).not.toMatch(/token|secret|api[_-]?key/i);
  });
});
