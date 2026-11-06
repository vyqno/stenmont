import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { app } from "../src";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CREATING = "0x" + "11".repeat(32);
const OPEN = "0x" + "22".repeat(32);
const PAID = "0x" + "33".repeat(32);

function fixture() {
  const data = new Map<string, string>([["order:abandoned", JSON.stringify({ id: "abandoned", amount: "1.00", checkoutKey: "saved-order-key" })]]);
  const env = { ORDERS: { get: async (key: string, type?: string) => { const value = data.get(key); return value ? type === "json" ? JSON.parse(value) : value : null; }, put: async (key: string, value: string) => { data.set(key, value); } } as unknown as KVNamespace,
    SHOP_URL: "https://install-proof-staging.stenmont.com", STENMONT_API_KEY: "unit-test-owner-value", STENMONT_WEBHOOK_SECRET: "unit-test-signing-value" };
  const invoices = [
    { id: CREATING, status: "creating", amountPaid: "0", metadata: { order: "abandoned" }, successUrl: env.SHOP_URL + "/orders/abandoned" },
    { id: OPEN, status: "open", amountPaid: "0", metadata: { order: "abandoned" }, successUrl: env.SHOP_URL + "/orders/abandoned" },
    { id: PAID, status: "paid", amountPaid: "1", metadata: { order: "paid" }, successUrl: env.SHOP_URL + "/orders/paid" },
  ];
  const faults = { lostResponse: false, terminalResponse: false };
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/invoices") return Response.json({ data: invoices });
    const id = path.split("/")[3];
    const invoice = invoices.find((x) => x.id === id);
    if (!invoice || !["creating", "open"].includes(invoice.status)) return new Response(null, { status: 400 });
    const body = JSON.parse(String(init?.body));
    const creating = invoice.status === "creating";
    if (creating && JSON.stringify(body) !== JSON.stringify({ creationKey: "saved-order-key", creationRequest: {
      amount: "1.00", successUrl: "https://install-proof-staging.stenmont.com/orders/abandoned",
      cancelUrl: "https://install-proof-staging.stenmont.com/orders/abandoned/pay", metadata: { order: "abandoned" },
    } })) return new Response(null, { status: 400 });
    invoice.status = creating ? "failed" : "expired";
    if (faults.lostResponse) { faults.lostResponse = false; throw new Error("Response lost after commit"); }
    return Response.json({ id, status: invoice.status, changed: !faults.terminalResponse, creationReleased: creating });
  };
  vi.stubGlobal("fetch", fetcher);
  const request = (authorized = true) => app.request("/maintenance/cleanup", { method: "POST", headers: authorized ? { authorization: `Bearer ${env.STENMONT_API_KEY}` } : {}, body: "{}" }, env);
  return { data, env, invoices, request, faults, fetcher };
}
afterEach(() => vi.unstubAllGlobals());

describe("install-store maintenance", () => {
  it("requires the operator secret", async () => {
    const t = fixture();
    expect((await t.request(false)).status).toBe(401);
  });
  it("retires only unpaid install invoices through the API and keeps tombstones", async () => {
    const t = fixture();
    const response = await t.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: [{ id: CREATING, status: "failed" }, { id: OPEN, status: "expired" }] });
    expect(t.data.has("retired:abandoned")).toBe(true);
    expect(t.data.has("retired:paid")).toBe(false);
    expect((await app.request("/orders/abandoned/checkout", { method: "POST" }, t.env)).status).toBe(410);
  });
  it("never retires an order whose signed payment marker already exists", async () => {
    const t = fixture(); t.data.set("paid:abandoned", "true");
    expect(await (await t.request()).json()).toMatchObject({ changed: [] });
    expect(t.data.has("retired:abandoned")).toBe(false);
  });
  it("does not retire catalogue or unrelated host invoices", async () => {
    const t = fixture(); t.invoices[0]!.successUrl = "https://app-staging.stenmont.com/store/proof"; t.invoices[1]!.successUrl = "https://other.example/order";
    expect(await (await t.request()).json()).toMatchObject({ changed: [] });
  });
  it("does not change local orders when the API fails", async () => {
    const t = fixture(); vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    expect((await t.request()).status).toBe(502);
    expect(t.data.has("retired:abandoned")).toBe(false);
  });
  it.each(["expired", "failed"])("repairs a listed %s invoice locally and preserves audit on repeat", async (status) => {
    const t = fixture(); t.invoices.splice(1); t.invoices[0]!.status = status;
    t.data.set("invoice:abandoned", JSON.stringify({ invoiceId: CREATING, payUrl: "https://app-staging.stenmont.com/pay/proof" }));
    const put = vi.spyOn(t.env.ORDERS, "put");
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (new URL(String(url)).pathname !== "/v1/invoices") throw new Error("Terminal invoices require no API mutation");
      return Response.json({ data: t.invoices });
    });
    expect(await (await t.request()).json()).toMatchObject({ changed: [], reconciled: [{ id: CREATING, status }] });
    expect(t.data.get("retired:abandoned")).toBe(status);
    expect(JSON.parse(t.data.get(`cleanup:${CREATING}`)!)).toMatchObject({ id: CREATING, status });
    const audit = t.data.get(`cleanup:${CREATING}`);
    put.mockClear();
    expect(await (await t.request()).json()).toMatchObject({ changed: [], reconciled: [] });
    expect(put).not.toHaveBeenCalled();
    expect(t.data.get(`cleanup:${CREATING}`)).toBe(audit);
    expect(JSON.parse(t.data.get("invoice:abandoned")!).invoiceId).toBe(CREATING);
  });
  it("preserves the first retirement when terminal invoices share an order", async () => {
    const t = fixture(); t.invoices.splice(2); t.invoices[0]!.status = "failed"; t.invoices[1]!.status = "expired";
    expect((await t.request()).status).toBe(200);
    expect(t.data.get("retired:abandoned")).toBe("failed");
    expect(JSON.parse(t.data.get(`cleanup:${CREATING}`)!)).toMatchObject({ id: CREATING, status: "failed" });
    expect(JSON.parse(t.data.get(`cleanup:${OPEN}`)!)).toMatchObject({ id: OPEN, status: "expired" });
    const put = vi.spyOn(t.env.ORDERS, "put");
    expect(await (await t.request()).json()).toMatchObject({ changed: [], reconciled: [] });
    expect(put).not.toHaveBeenCalled();
    expect(t.data.get("retired:abandoned")).toBe("failed");
  });
  it.each(["open", "creating"])("repairs a changed:false terminal response for %s", async (status) => {
    const t = fixture(); t.invoices.splice(1); t.invoices[0]!.status = status; t.faults.terminalResponse = true;
    const response = await t.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: [], reconciled: [{ id: CREATING, status: status === "open" ? "expired" : "failed" }] });
    expect(t.data.has("retired:abandoned")).toBe(true);
  });
  it("recovers on retry when the API committed but its response was lost", async () => {
    const t = fixture(); t.invoices.splice(0, 1); t.invoices.splice(1); t.faults.lostResponse = true;
    expect((await t.request()).status).toBe(502);
    expect(t.data.has("retired:abandoned")).toBe(false);
    expect(await (await t.request()).json()).toMatchObject({ changed: [], reconciled: [{ id: OPEN, status: "expired" }] });
    expect((await app.request("/orders/abandoned/checkout", { method: "POST" }, t.env)).status).toBe(410);
  });
  it.each(["retired:abandoned", `cleanup:${OPEN}`])("recovers after a KV write fails at %s", async (key) => {
    const t = fixture(); t.invoices.splice(0, 1); t.invoices.splice(1);
    const originalPut = t.env.ORDERS.put.bind(t.env.ORDERS); let fail = true;
    vi.spyOn(t.env.ORDERS, "put").mockImplementation(async (target, value) => {
      if (target === key && fail) { fail = false; throw new Error("KV unavailable"); }
      await originalPut(target, value);
    });
    expect((await t.request()).status).toBe(502);
    expect(await (await t.request()).json()).toMatchObject({ changed: [], reconciled: [{ id: OPEN, status: "expired" }] });
    expect(t.data.get("retired:abandoned")).toBe("expired");
    expect(JSON.parse(t.data.get(`cleanup:${OPEN}`)!)).toMatchObject({ id: OPEN, status: "expired" });
  });
  it.each(["expired", "failed", "paid", "settled"])("never retires %s invoices with a paid marker", async (status) => {
    const t = fixture(); t.invoices.splice(1); t.invoices[0]!.status = status; t.data.set("paid:abandoned", "true");
    expect(await (await t.request()).json()).toMatchObject({ changed: [] });
    expect(t.data.has("retired:abandoned")).toBe(false);
    expect(t.data.has(`cleanup:${CREATING}`)).toBe(false);
  });
  it.each(["paid", "settled"])("leaves %s invoices untouched even with zero amountPaid", async (status) => {
    const t = fixture(); t.invoices.splice(1); t.invoices[0]!.status = status;
    expect(await (await t.request()).json()).toMatchObject({ changed: [] });
    expect(t.data.has("retired:abandoned")).toBe(false);
  });
  it("does not reconcile a terminal invoice from a foreign host", async () => {
    const t = fixture(); t.invoices.splice(1); t.invoices[0]!.status = "expired"; t.invoices[0]!.successUrl = "https://other.example/orders/abandoned";
    expect(await (await t.request()).json()).toMatchObject({ changed: [] });
    expect(t.data.has("retired:abandoned")).toBe(false);
  });

});


describe("staging scheduled cleanup",()=>{
  it("runs the same guarded cleanup and preserves the paid receipt",async()=>{
    const w=fixture(),pending:Promise<unknown>[]=[];
    worker.scheduled({} as ScheduledController,w.env,{waitUntil:(promise:Promise<unknown>)=>{pending.push(promise);}} as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(w.invoices.map(invoice=>invoice.status)).toEqual(["failed","expired","paid"]);
  });
  it("enables the existing15-minute trigger only on staging",()=>{
    const config=JSON.parse(readFileSync(join(import.meta.dirname,"../wrangler.jsonc"),"utf8"));
    expect(config.env.staging.triggers.crons).toEqual(["*/15 * * * *"]);
    expect(config.triggers).toBeUndefined(); expect(config.env.production).toBeUndefined();
  });
});
