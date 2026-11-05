import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

const post = (t: ReturnType<typeof setup>, key: string, body: unknown) =>
  t.req("/v1/webhook-endpoints", { method: "POST", key, body: JSON.stringify(body) });

describe("webhook endpoints", () => {
  it("creates an endpoint and returns the signing secret exactly once", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { url: "https://shop.example/hooks", events: ["invoice.paid"] });
    expect(res.status).toBe(201);
    const ep = (await res.json()) as { id: string; secret: string; events: string[] };
    expect(ep.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(ep.events).toEqual(["invoice.paid"]);
    const list = (await (await t.req("/v1/webhook-endpoints", { key })).json()) as { data: Record<string, unknown>[] };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty("secret");
  });
  it.each([
    ["http url", { url: "http://shop.example/hooks" }],
    ["not a url", { url: "nope" }],
    ["unknown event", { url: "https://x.example/h", events: ["invoice.exploded"] }],
    ["local address", { url: "https://localhost/h" }],
    ["private address", { url: "https://192.168.1.5/h" }],
    ["unknown field", { url: "https://x.example/h", extra: 1 }],
  ])("rejects %s", async (_n, payload) => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await post(t, key, payload)).status).toBe(400);
  });
  it("deleting is tenant-scoped", async () => {
    const t = setup();
    const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    const ep = (await (await post(t, a, { url: "https://shop.example/hooks" })).json()) as { id: string };
    expect((await t.req(`/v1/webhook-endpoints/${ep.id}`, { method: "DELETE", key: b })).status).toBe(404);
    expect((await t.req(`/v1/webhook-endpoints/${ep.id}`, { method: "DELETE", key: a })).status).toBe(204);
    expect(((await (await t.req("/v1/webhook-endpoints", { key: a })).json()) as { data: unknown[] }).data).toHaveLength(0);
  });
});
