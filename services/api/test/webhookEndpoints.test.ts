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
  it("replays one registration without replacing its endpoint or signing secret", async () => {
    const t = setup(); const key = await seedMerchant(t.db);
    const request = () => t.req("/v1/webhook-endpoints", { method: "POST", key, idem: "install-registration", body: JSON.stringify({ url: "https://shop.example/hooks" }) });
    const first = await request(); const endpoint = await first.json() as { id: string; secret: string };
    const retry = await request();
    expect(first.status).toBe(201); expect(retry.status).toBe(201);
    const repeated = await retry.json() as { id: string; secret: string };
    expect(repeated.id).toBe(endpoint.id);
    expect(repeated.secret === endpoint.secret).toBe(true);
    const list = await (await t.req("/v1/webhook-endpoints", { key })).json() as { data: unknown[] };
    expect(list.data).toHaveLength(1);
  });
  it("refuses to reuse a registration key for a different destination", async () => {
    const t = setup(); const key = await seedMerchant(t.db);
    const request = (url: string) => t.req("/v1/webhook-endpoints", { method: "POST", key, idem: "install-registration", body: JSON.stringify({ url }) });
    expect((await request("https://shop.example/hooks")).status).toBe(201);
    const changed = await request("https://other.example/hooks");
    expect(changed.status).toBe(422);
    expect(await changed.json()).toMatchObject({ error: { code: "idempotency_key_reuse" } });
  });
  it("scopes a saved registration key to its authenticated business", async () => {
    const t = setup(); const a = await seedMerchant(t.db);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    const request = (key: string) => t.req("/v1/webhook-endpoints", { method: "POST", key, idem: "install-registration", body: JSON.stringify({ url: "https://shop.example/hooks" }) });
    const first = await (await request(a)).json() as { id: string; secret: string };
    const other = await (await request(b)).json() as { id: string; secret: string };
    expect(other.id).not.toBe(first.id); expect(other.secret).not.toBe(first.secret);
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
