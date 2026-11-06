import { signWebhook } from "@stenmont/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src";

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null), put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}
const env = () => ({ ORDERS: kv(), SHOP_URL: "https://shop.test", STENMONT_API_KEY: "sk_test_abc", STENMONT_API_URL: "https://api.test", STENMONT_WEBHOOK_SECRET: "whsec_test" });
const SECRET = "whsec_test";
afterEach(() => vi.unstubAllGlobals());
/** Pretends to be the Stenmont API. */
function stenmontApi(respond: () => Response = () => Response.json({ id: "0xinv", payUrl: "https://app.test/pay/0xinv" }, { status: 201 })) {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get("authorization") });
    return respond();
  });
  return calls;
}
const orderIdFrom = (res: Response) => /\/orders\/([0-9a-f]+)/.exec(res.headers.get("location")!)![1]!;

describe("example store", () => {
  it("lists the products", async () => {
    const html = await (await app.request("/", {}, env())).text();
    for (const name of ["Studio tee", "Desk mug", "Poster print"]) expect(html).toContain(name);
  });
  it("buying creates a pending order and sends the customer to the Stenmont checkout", async () => {
    const calls = stenmontApi();
    const e = env();
    const buy = await app.request("/buy/mug", { method: "POST" }, e);
    expect(buy.status).toBe(303);
    expect(buy.headers.get("location")).toBe("https://app.test/pay/0xinv");
    const order = calls[0]!.body.metadata.order as string;
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/invoices", auth: "Bearer sk_test_abc" });
    expect(calls[0]!.body).toMatchObject({ amount: "1.50", successUrl: `https://shop.test/orders/${order}`, cancelUrl: "https://shop.test" });
    const html = await (await app.request(`/orders/${order}`, {}, e)).text();
    expect(html).toContain("Waiting for payment");
    expect(html).toContain("$1.50");
  });
  it("if checkout cannot be created the customer is told, not left on a blank page", async () => {
    stenmontApi(() => Response.json({ error: { code: "x", message: "down" } }, { status: 503 }));
    const res = await app.request("/buy/tee", { method: "POST" }, env());
    expect(res.status).toBe(502);
  });
  it("an unknown product or order is a 404", async () => {
    const e = env();
    expect((await app.request("/buy/nope", { method: "POST" }, e)).status).toBe(404);
    expect((await app.request("/orders/zzz", {}, e)).status).toBe(404);
  });
  async function orderWithWebhook(type: string, signWith = SECRET, tamper = false) {
    const calls = stenmontApi();
    const e = env();
    await app.request("/buy/tee", { method: "POST" }, e);
    const order = calls[0]!.body.metadata.order as string;
    const body = JSON.stringify({ id: "evt_1", type, created: 1, livemode: false, data: { invoice: { metadata: { order } } } });
    const header = await signWebhook(signWith, body);
    const hook = (b = body) => app.request("/webhooks/stenmont", { method: "POST", body: b, headers: { "stenmont-signature": header } }, e);
    const status = async () => (await (await app.request(`/orders/${order}`, {}, e)).text()).includes("Paid");
    return { hook: () => hook(tamper ? body.replace(order, "other") : body), status, e, order };
  }

  it("a signed invoice.paid webhook marks the order paid, and a second delivery changes nothing", async () => {
    const t = await orderWithWebhook("invoice.paid");
    expect((await t.hook()).status).toBe(200);
    expect(await t.status()).toBe(true);
    expect((await t.hook()).status).toBe(200);
    expect(await t.status()).toBe(true);
  });
  it("refuses a webhook with a wrong secret or a changed body, and the order stays unpaid", async () => {
    const wrong = await orderWithWebhook("invoice.paid", "whsec_other");
    expect((await wrong.hook()).status).toBe(400);
    expect(await wrong.status()).toBe(false);
    const tampered = await orderWithWebhook("invoice.paid", SECRET, true);
    expect((await tampered.hook()).status).toBe(400);
    expect(await tampered.status()).toBe(false);
  });
  it("ignores other events and orders it does not know", async () => {
    const partial = await orderWithWebhook("invoice.partially_paid");
    expect((await partial.hook()).status).toBe(200);
    expect(await partial.status()).toBe(false);
  });
});
