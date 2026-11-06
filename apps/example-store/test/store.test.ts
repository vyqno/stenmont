import { describe, expect, it } from "vitest";
import { app } from "../src";

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null), put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}
const env = () => ({ ORDERS: kv(), SHOP_URL: "https://shop.test" });
const orderIdFrom = (res: Response) => /\/orders\/([0-9a-f]+)/.exec(res.headers.get("location")!)![1]!;

describe("example store (baseline)", () => {
  it("lists the products", async () => {
    const html = await (await app.request("/", {}, env())).text();
    for (const name of ["Studio tee", "Desk mug", "Poster print"]) expect(html).toContain(name);
  });
  it("buying creates a pending order", async () => {
    const e = env();
    const buy = await app.request("/buy/mug", { method: "POST" }, e);
    expect(buy.status).toBe(303);
    const html = await (await app.request(`/orders/${orderIdFrom(buy)}`, {}, e)).text();
    expect(html).toContain("Waiting for payment");
    expect(html).toContain("$8.50");
  });
  it("an unknown product or order is a 404", async () => {
    const e = env();
    expect((await app.request("/buy/nope", { method: "POST" }, e)).status).toBe(404);
    expect((await app.request("/orders/zzz", {}, e)).status).toBe(404);
  });
  it("the stand-in pay button marks the order paid", async () => {
    const e = env();
    const id = orderIdFrom(await app.request("/buy/tee", { method: "POST" }, e));
    await app.request(`/orders/${id}/fake-pay`, { method: "POST" }, e);
    expect(await (await app.request(`/orders/${id}`, {}, e)).text()).toContain("Paid");
  });
});
