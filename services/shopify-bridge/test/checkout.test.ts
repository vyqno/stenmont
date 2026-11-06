import { describe, expect, it } from "vitest";
import { createApp } from "../src";
import { world } from "./fakes";
import { env, fake } from "./helpers";

const D = "gid://shopify/DraftOrder/101";
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, e = env(), headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, e);

describe("POST /checkout", () => {
  it("prices from the Shopify draft (not the client) and returns a pay link with metadata and return urls", async () => {
    const w = world({ drafts: { [D]: { amount: "10.00", currency: "USD" } } });
    const app = createApp(w.d);
    const res = await post(app, "/checkout", { draftOrderId: "101", amount: "0.01", total: "0.01" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ payUrl: "https://app.stenmont.test/pay/0xinv1", invoiceId: "0xinv1", draftOrderId: "101" });
    const st = w.calls.find((c) => c.url.includes("api.stenmont.test"))!;
    expect(st.body).toMatchObject({
      amount: "10.00",
      successUrl: "https://shop.example.com/?stenmont=paid&draft=101",
      cancelUrl: "https://shop.example.com/cart",
      metadata: { shop: "demo-shop.myshopify.com", draftOrderId: D, shopifyTotal: "10.00", shopifyCurrency: "USD", rate: "1" },
    });
    expect(st.headers.get("authorization")).toBe(`Bearer ${fake("stenmont_key")}`);
  });

  it("converts a non-USD shop with the owner's rate and records it", async () => {
    const w = world({ drafts: { [D]: { amount: "8350.00", currency: "INR" } } });
    const res = await post(createApp(w.d), "/checkout", { draftOrderId: D }, env({ RATE_PER_USD: "83.5" }));
    expect(res.status).toBe(200);
    expect(w.calls.find((c) => c.url.includes("api.stenmont.test"))!.body).toMatchObject({ amount: "100.00", metadata: { shopifyTotal: "8350.00", shopifyCurrency: "INR", rate: "83.5" } });
  });

  it("answers 422 needs_rate for a non-USD shop without a rate and creates nothing", async () => {
    const w = world({ drafts: { [D]: { amount: "500.00", currency: "INR" } } });
    const res = await post(createApp(w.d), "/checkout", { draftOrderId: D });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("needs_rate");
    expect(w.state.created).toBe(0);
  });

  it("is idempotent per draft order: the same draft gives the same invoice", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const e = env();
    const a: any = await (await post(app, "/checkout", { draftOrderId: D }, e)).json();
    const b: any = await (await post(app, "/checkout", { draftOrderId: D }, e)).json();
    expect(b.invoiceId).toBe(a.invoiceId);
    expect(w.calls.filter((c) => c.url.includes("api.stenmont.test")).length).toBe(1);
    // even with a fresh KV, the Stenmont idempotency key returns the same invoice
    const c2: any = await (await post(app, "/checkout", { draftOrderId: D }, env())).json();
    expect(c2.invoiceId).toBe(a.invoiceId);
    expect(w.state.created).toBe(1);
  });

  it("makes a new invoice when the draft's price changed", async () => {
    const w = world({ drafts: { [D]: { amount: "10.00" } } });
    const app = createApp(w.d);
    const e = env();
    const a: any = await (await post(app, "/checkout", { draftOrderId: D }, e)).json();
    w.drafts[D]!.amount = "12.00";
    const b: any = await (await post(app, "/checkout", { draftOrderId: D }, e)).json();
    expect(b.invoiceId).not.toBe(a.invoiceId);
  });

  it("turns cartLines into a draft order (ids and quantities only) and invoices its price", async () => {
    const w = world();
    const res = await post(createApp(w.d), "/checkout", { cartLines: [{ variantId: 55, quantity: 2, price: "0.01" }, { variantId: "gid://shopify/ProductVariant/56", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(w.state.createdDrafts[0]).toEqual({ lineItems: [{ variantId: "gid://shopify/ProductVariant/55", quantity: 2 }, { variantId: "gid://shopify/ProductVariant/56", quantity: 1 }], tags: ["stenmont"] });
    expect(w.calls.find((c) => c.url.includes("api.stenmont.test"))!.body.amount).toBe("20.00");
  });

  it("rejects bad input before calling anyone", async () => {
    const w = world();
    const app = createApp(w.d);
    for (const body of [{}, { draftOrderId: "abc" }, { draftOrderId: "gid://shopify/Order/1" }, { cartLines: [] }, { cartLines: [{ variantId: "x", quantity: 1 }] }, { cartLines: [{ variantId: 1, quantity: 0 }] }, { cartLines: [{ variantId: 1, quantity: 1.5 }] }, { cartLines: [{ variantId: 1, quantity: 101 }] }]) {
      expect((await post(app, "/checkout", body)).status).toBe(422);
    }
    expect((await app.request("/checkout", { method: "POST", body: "not json" }, env())).status).toBe(400);
    expect(w.calls.length).toBe(0);
  });

  it("refuses completed drafts, empty drafts and unknown drafts", async () => {
    const w = world({ drafts: { [D]: { status: "COMPLETED" }, "gid://shopify/DraftOrder/102": { lines: 0 } } });
    const app = createApp(w.d);
    expect((await post(app, "/checkout", { draftOrderId: D })).status).toBe(409);
    expect((await post(app, "/checkout", { draftOrderId: "102" })).status).toBe(422);
    expect((await post(app, "/checkout", { draftOrderId: "103" })).status).toBe(404);
  });

  it("does not leak Stenmont's error text or any secret", async () => {
    const w = world({ drafts: { [D]: {} }, stenmontStatus: 500 });
    const res = await post(createApp(w.d), "/checkout", { draftOrderId: D });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("internal secret text");
    expect(text).not.toContain(fake("stenmont_key"));
    expect(text).not.toContain(fake("admin"));
  });

  it("refuses to run with a bad shop domain and sends nothing", async () => {
    const w = world({ drafts: { [D]: {} } });
    const res = await post(createApp(w.d), "/checkout", { draftOrderId: D }, env({ SHOPIFY_SHOP_DOMAIN: "evil.example.com" }));
    expect(res.status).toBe(500);
    expect(w.calls.length).toBe(0);
  });

  it("only ever sends the admin token to the shop's admin API", async () => {
    const w = world({ drafts: { [D]: {} } });
    await post(createApp(w.d), "/checkout", { draftOrderId: D });
    for (const c of w.calls) {
      const hasToken = c.headers.get("x-shopify-access-token") !== null;
      expect(hasToken).toBe(c.url.startsWith("https://demo-shop.myshopify.com/admin/api/"));
      expect(c.headers.get("authorization") ?? "").not.toContain(fake("admin"));
      if (hasToken) expect(c.redirect).toBe("manual");
    }
  });

  it("limits the storefront origins (CORS) and answers preflight", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const ok = await post(app, "/checkout", { draftOrderId: D }, env(), { origin: "https://shop.example.com" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://shop.example.com");
    const bad = await post(app, "/checkout", { draftOrderId: D }, env(), { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await app.request("/checkout", { method: "OPTIONS", headers: { origin: "https://shop.example.com", "access-control-request-method": "POST" } }, env());
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    const star = await post(app, "/checkout", { draftOrderId: D }, env({ ALLOWED_ORIGINS: "*" }), { origin: "https://evil.example" });
    expect(star.status).toBe(403);
  });

  it("rate limits per caller", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const e = env();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post(app, "/checkout", { draftOrderId: D }, e, { "cf-connecting-ip": "1.2.3.4" })).status;
    expect(last).toBe(429);
    expect((await post(app, "/checkout", { draftOrderId: D }, e, { "cf-connecting-ip": "5.6.7.8" })).status).toBe(200);
  });
});

describe("POST /invoice-send", () => {
  const auth = { authorization: `Bearer ${fake("bridge_admin")}` };
  it("rejects a missing or wrong bearer before touching Shopify", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    expect((await post(app, "/invoice-send", { draftOrderId: D })).status).toBe(401);
    expect((await post(app, "/invoice-send", { draftOrderId: D }, env(), { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(app, "/invoice-send", { draftOrderId: D }, env({ BRIDGE_ADMIN_TOKEN: "" }), { authorization: "Bearer " })).status).toBe(401);
    expect(w.calls.length).toBe(0);
  });
  it("creates the invoice and sends Shopify's invoice email with the pay link in the message", async () => {
    const w = world({ drafts: { [D]: {} } });
    const res = await post(createApp(w.d), "/invoice-send", { draftOrderId: D, message: "Thanks for your order." }, env(), auth);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).sent).toBe(true);
    expect(w.state.sent).toEqual([{ id: D, email: { customMessage: "Thanks for your order.\nhttps://app.stenmont.test/pay/0xinv1" } }]);
  });
  it("uses a default message and rejects an oversized one", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    await post(app, "/invoice-send", { draftOrderId: D }, env(), auth);
    expect(w.state.sent[0].email.customMessage).toContain("https://app.stenmont.test/pay/");
    expect((await post(app, "/invoice-send", { draftOrderId: D, message: "x".repeat(1001) }, env(), auth)).status).toBe(422);
  });
  it("surfaces Shopify's refusal (for example a draft with no email) as a 422", async () => {
    const w = world({ drafts: { [D]: {} }, shopifyErrors: { draftOrderInvoiceSend: { draftOrder: null, userErrors: [{ field: null, message: "To can't be blank" }] } } });
    const res = await post(createApp(w.d), "/invoice-send", { draftOrderId: D }, env(), auth);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.message).toContain("To can't be blank");
  });
  it("is rate limited", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const e = env();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post(app, "/invoice-send", { draftOrderId: D }, e, { ...auth, "cf-connecting-ip": "9.9.9.9" })).status;
    expect(last).toBe(429);
  });
});
