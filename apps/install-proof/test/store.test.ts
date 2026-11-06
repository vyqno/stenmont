import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app, baseUnits } from "../src";

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null), put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}
const env = () => ({ ORDERS: kv(), SHOP_URL: "https://install-proof-staging.stenmont.com", STENMONT_API_KEY: "unit-test-api-value", STENMONT_WEBHOOK_SECRET: "unit-test-signing-value" });
const orderIdFrom = (res: Response) => /\/orders\/([0-9a-f]+)/.exec(res.headers.get("location")!)![1]!;
const buy = async (e: ReturnType<typeof env>, sku = "mug") => orderIdFrom(await app.request(`/buy/${sku}`, { method: "POST" }, e));
function signature(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
function webhook(e: ReturnType<typeof env>, body: string, header = signature(body, e.STENMONT_WEBHOOK_SECRET)) {
  return app.request("/webhooks/stenmont", { method: "POST", body, headers: { "Stenmont-Signature": header } }, e);
}
afterEach(() => vi.unstubAllGlobals());

describe("Stenmont checkout", () => {
  it("lists products and a server-priced 1.00 test payment", async () => {
    const e = env();
    expect(await (await app.request("/", {}, e)).text()).toContain("Studio tee");
    const id = await buy(e, "test");
    expect(await (await app.request(`/orders/${id}/pay`, {}, e)).text()).toContain("Pay $1.00");
  });
  it("creates a pending order and exposes a Pay button", async () => {
    const e = env(); const id = await buy(e);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain("Waiting for payment");
    expect(await (await app.request(`/orders/${id}/pay`, {}, e)).text()).toContain(`/orders/${id}/checkout`);
    expect((await app.request(`/orders/${id}/fake-pay`, { method: "POST" }, e)).status).toBe(404);
  });
  it("returns 404 for missing products and orders", async () => {
    const e = env();
    for (const [url, method] of [["/buy/nope", "POST"], ["/orders/nope/pay", "GET"], ["/orders/nope/checkout", "POST"], ["/orders/nope", "GET"]]) {
      expect((await app.request(url!, { method }, e)).status).toBe(404);
    }
  });
  it("ignores browser amounts, keeps credentials server-side and reuses the saved invoice", async () => {
    const e = env(); const id = await buy(e);
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    vi.stubGlobal("fetch", fetcher);
    for (let i = 0; i < 2; i++) {
      const res = await app.request(`/orders/${id}/checkout`, { method: "POST", body: JSON.stringify({ amount: "0.01" }) }, e);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("https://app-staging.stenmont.com/pay/invoice-test");
      expect(await res.text()).not.toContain(e.STENMONT_API_KEY);
    }
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api-staging.stenmont.com/v1/invoices");
    expect(init.headers.Authorization).toBe(`Bearer ${e.STENMONT_API_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ amount: "8.50", successUrl: `${e.SHOP_URL}/orders/${id}`, cancelUrl: `${e.SHOP_URL}/orders/${id}/pay`, metadata: { order: id } });
    expect(init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const stored = await e.ORDERS.get<{ checkoutKey: string }>(`order:${id}`, "json");
    expect(init.headers["Idempotency-Key"]).toBe(stored!.checkoutKey);
  });
  it("waits for a confirmed invoice beyond eight seconds before redirecting", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const e = env(); const id = await buy(e);
      vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
        await new Promise((resolve) => setTimeout(resolve, 9000));
        init.signal?.throwIfAborted();
        return Response.json({ id: "slow-invoice", payUrl: "https://app-staging.stenmont.com/pay/slow-invoice" });
      });
      const response = app.request(`/orders/${id}/checkout`, { method: "POST" }, e);
      await vi.advanceTimersByTimeAsync(9000);
      expect((await response).status).toBe(303);
    } finally { timeout.mockRestore(); vi.useRealTimers(); }
  });
  it("shows paused payments without disclosing upstream errors", async () => {
    const e = env(); const id = await buy(e);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "payments_paused", message: e.STENMONT_API_KEY } }, { status: 403 })));
    const res = await app.request(`/orders/${id}/checkout`, { method: "POST" }, e);
    expect(res.status).toBe(503); expect(await res.text()).toBe("Payments are temporarily unavailable");
  });
  it.each(["network", "invalid-json", "unsafe-url", "upstream-error"])("handles %s failures without marking paid", async (failure) => {
    const e = env(); const id = await buy(e);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      if (failure === "network") throw new Error("network");
      if (failure === "invalid-json") return new Response("not json");
      if (failure === "unsafe-url") return Response.json({ payUrl: "https://evil.example/pay/x" });
      return Response.json({ error: { code: "chain_error" } }, { status: 502 });
    }));
    expect((await app.request(`/orders/${id}/checkout`, { method: "POST" }, e)).status).toBe(502);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain("Waiting for payment");
  });
  it("fails closed when API configuration is missing", async () => {
    const e = env(); const id = await buy(e); e.STENMONT_API_KEY = "";
    expect((await app.request(`/orders/${id}/checkout`, { method: "POST" }, e)).status).toBe(503);
  });
});

describe("signed webhooks", () => {
  it("accepts exact raw bytes, rotated signatures and duplicate paid deliveries", async () => {
    const e = env(); const id = await buy(e);
    await e.ORDERS.put(`invoice:${id}`, JSON.stringify({ invoiceId: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    const body = JSON.stringify({ type: "invoice.paid", data: { invoice: { id: "invoice-test", amount: "8.500000", amountPaid: "8.5", metadata: { order: id } } } }, null, 2);
    const header = signature(body, e.STENMONT_WEBHOOK_SECRET).replace(",v1=", `,v1=${"0".repeat(64)},v1=`);
    expect((await webhook(e, body, header)).status).toBe(200);
    expect((await webhook(e, body, header)).status).toBe(200);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain('data-testid="status">Paid');
    expect((await app.request(`/orders/${id}/checkout`, { method: "POST" }, e)).headers.get("location")).toBe(`/orders/${id}`);
  });
  it.each([-300, 300])("accepts the inclusive %s second timestamp boundary", async (offset) => {
    vi.spyOn(Date, "now").mockReturnValue(1793960000900);
    const e = env(); const body = '{"type":"site.test"}';
    try {
      expect((await webhook(e, body, signature(body, e.STENMONT_WEBHOOK_SECRET, 1793960000 + offset))).status).toBe(200);
    } finally { vi.restoreAllMocks(); }
  });
  it("fails closed without a webhook secret", async () => {
    const e = env(); const body = '{"type":"site.test"}';
    const header = signature(body, e.STENMONT_WEBHOOK_SECRET); e.STENMONT_WEBHOOK_SECRET = "";
    expect((await webhook(e, body, header)).status).toBe(503);
  });
  it.each([-301, 301])("rejects timestamps %s seconds from now", async (offset) => {
    const e = env(); const body = '{"type":"site.test"}';
    expect((await webhook(e, body, signature(body, e.STENMONT_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) + offset))).status).toBe(400);
  });
  it.each(["", "t=abc,v1=bad", "t=1,t=2,v1=bad"])("rejects malformed headers: %s", async (header) => {
    expect((await webhook(env(), '{"type":"site.test"}', header)).status).toBe(400);
  });
  it("rejects bad signatures and changed body bytes", async () => {
    const e = env(); const body = '{"type":"site.test"}';
    expect((await webhook(e, body, signature(body, "wrong-secret"))).status).toBe(400);
    expect((await webhook(e, body + " ", signature(body, e.STENMONT_WEBHOOK_SECRET))).status).toBe(400);
  });
  it.each(["site.test", "invoice.created", "future.event"])("acknowledges %s without changing orders", async (type) => {
    const e = env(); const id = await buy(e);
    expect((await webhook(e, JSON.stringify({ type }))).status).toBe(200);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain("Waiting for payment");
  });
  it("rejects signed malformed JSON or missing order metadata", async () => {
    for (const body of ["{", "null", "{}", '{"type":"invoice.paid"}']) {
      expect((await webhook(env(), body)).status).toBe(400);
    }
  });
});


describe("checkout reconciliation and retries", () => {
  it("reuses the persisted idempotency key after an ambiguous timeout", async () => {
    const e = env(); const id = await buy(e);
    const request = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({ id: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    vi.stubGlobal("fetch", request);
    expect((await app.request(`/orders/${id}/checkout`, { method: "POST" }, e)).status).toBe(502);
    expect((await app.request(`/orders/${id}/checkout`, { method: "POST" }, e)).status).toBe(303);
    expect(request.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(request.mock.calls[1]![1].headers["Idempotency-Key"]);
  });
  it("uses one key across concurrent double clicks", async () => {
    const e = env(); const id = await buy(e);
    const request = vi.fn().mockImplementation(async () => Response.json({ id: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    vi.stubGlobal("fetch", request);
    await Promise.all([1, 2].map(() => app.request(`/orders/${id}/checkout`, { method: "POST" }, e)));
    expect(request.mock.calls.length).toBe(2);
    expect(request.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(request.mock.calls[1]![1].headers["Idempotency-Key"]);
  });
  it("a late concurrent checkout response cannot revert a webhook paid marker", async () => {
    const e = env(); const id = await buy(e);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 2) await gate;
      return Response.json({ id: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" });
    }));
    const first = app.request(`/orders/${id}/checkout`, { method: "POST" }, e);
    const second = app.request(`/orders/${id}/checkout`, { method: "POST" }, e);
    await first;
    expect(calls).toBe(2);
    const body = JSON.stringify({ type: "invoice.paid", data: { invoice: { id: "invoice-test", amount: "8.50", amountPaid: "9.00", metadata: { order: id } } } });
    expect((await webhook(e, body)).status).toBe(200);
    release(); await second;
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain('data-testid="status">Paid');
  });
  it("retries an early paid webhook until the invoice binding is stored", async () => {
    const e = env(); const id = await buy(e);
    const body = JSON.stringify({ type: "invoice.paid", data: { invoice: { id: "invoice-test", amount: "8.50", amountPaid: "8.50", metadata: { order: id } } } });
    expect((await webhook(e, body)).status).toBe(503);
    await e.ORDERS.put(`invoice:${id}`, JSON.stringify({ invoiceId: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    expect((await webhook(e, body)).status).toBe(200);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain('data-testid="status">Paid');
  });
  it.each([
    { id: "different", amount: "8.50", amountPaid: "8.50" },
    { id: "invoice-test", amount: "1.00", amountPaid: "8.50" },
    { id: "invoice-test", amount: "8.50", amountPaid: "8.499999" },
    { id: "invoice-test", amount: "8.5000001", amountPaid: "8.50" },
    { id: "invoice-test", amount: 8.5, amountPaid: "8.50" },
    { id: "invoice-test", amount: "8.50", amountPaid: "NaN" },
    { amount: "8.50", amountPaid: "8.50" },
  ])("rejects signed mismatched invoice %#", async (invoice) => {
    const e = env(); const id = await buy(e);
    await e.ORDERS.put(`invoice:${id}`, JSON.stringify({ invoiceId: "invoice-test", payUrl: "https://app-staging.stenmont.com/pay/invoice-test" }));
    expect((await webhook(e, JSON.stringify({ type: "invoice.paid", data: { invoice: { ...invoice, metadata: { order: id } } } }))).status).toBe(400);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain("Waiting for payment");
  });
  it("compares integer base units exactly beyond floating point precision", () => {
    expect(baseUnits("9007199254740993.000001")).toBe(9007199254740993000001n);
    expect(baseUnits("8.5")).toBe(baseUnits("8.500000"));
    for (const bad of ["1e1", "-1", "1.0000001", "NaN", 1, null]) expect(baseUnits(bad)).toBeNull();
  });
});
