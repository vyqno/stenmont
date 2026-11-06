import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

describe("GET /v1/api-keys", () => {
  it("shows each key's visible start and date, never the key or its hash", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await t.req("/v1/api-keys", { key });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ display: `sk_test_${key.slice(8, 16)}…`, revoked: false });
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toMatch(/hash/);
  });
  it("lists only the signed-in business's keys", async () => {
    const t = setup();
    const a = await seedMerchant(t.db);
    await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    const body = (await (await t.req("/v1/api-keys", { key: a })).json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
  it("needs a key or session", async () => {
    expect((await setup().req("/v1/api-keys")).status).toBe(401);
  });
});
