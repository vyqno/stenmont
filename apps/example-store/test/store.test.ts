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

describe("paid API (x402): an AI agent pays per request in USDT", () => {
  const payEnv = { ...env(), PAY_TO: "0x683059bd0f23Ec06c3BCa7e4c1797351Ac1454c8", X402_FACILITATOR_URL: "https://facilitator.test" };
  const header = (over: object = {}) =>
    btoa(JSON.stringify({ x402Version: 2, accepted: {}, payload: { signature: "0x", authorization: { from: "0x2222222222222222222222222222222222222222", to: payEnv.PAY_TO, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: `0x${"1".repeat(64)}` } }, ...over }));
  function facilitator(answers: { verify?: object; settle?: object } = {}) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(new URL(url).pathname);
      if (url.endsWith("/verify")) return Response.json(answers.verify ?? { isValid: true, payer: "0x2222222222222222222222222222222222222222" });
      return Response.json(answers.settle ?? { success: true, transaction: `0x${"a".repeat(64)}`, network: "eip155:1874", payer: "0x2222222222222222222222222222222222222222" });
    });
    return calls;
  }
  it("asks for payment first: 402 with the price, the official USDT and the business as payee", async () => {
    const res = await app.request("/api/premium/quote", {}, payEnv);
    expect(res.status).toBe(402);
    const reqs = ((await res.json()) as { accepts: { amount: string; payTo: string; network: string; asset: string }[] }).accepts[0]!;
    expect(reqs).toMatchObject({ amount: "10000", payTo: payEnv.PAY_TO, network: "eip155:1874", asset: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" });
  });
  it("gives the answer once the payment is verified and settled", async () => {
    const calls = facilitator();
    const res = await app.request("/api/premium/quote", { headers: { "payment-signature": header() } }, payEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(((await res.json()) as { sku: string }).sku).toBe("tee");
    expect(calls).toEqual(["/verify", "/settle"]);
  });
  it("gives nothing when the payment is not valid", async () => {
    facilitator({ verify: { isValid: false, invalidReason: "invalid_exact_evm_payload_authorization_value" } });
    const res = await app.request("/api/premium/quote", { headers: { "payment-signature": header() } }, payEnv);
    expect(res.status).toBe(402);
    expect(await res.text()).not.toContain('"sku"');
  });
});
