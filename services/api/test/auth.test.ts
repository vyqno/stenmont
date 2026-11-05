import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

describe("API key auth", () => {
  it("rejects a missing, malformed or unknown key with 401", async () => {
    const { req, db } = setup();
    await seedMerchant(db);
    expect((await req("/v1/me")).status).toBe(401);
    expect((await req("/v1/me", { key: "nope" })).status).toBe(401);
    expect((await req("/v1/me", { key: `sk_test_${"b".repeat(32)}` })).status).toBe(401);
    // right prefix, wrong rest of the key
    expect((await req("/v1/me", { key: `sk_test_${"a".repeat(8)}${"c".repeat(24)}` })).status).toBe(401);
  });
  it("accepts a valid key and returns the merchant", async () => {
    const { req, db } = setup();
    const key = await seedMerchant(db);
    const res = await req("/v1/me", { key });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "m_1", name: "Acme" });
  });
  it("rejects a revoked key", async () => {
    const { req, db } = setup();
    const key = await seedMerchant(db);
    await db.prepare("update api_keys set revoked_at = ?").bind(new Date().toISOString()).run();
    expect((await req("/v1/me", { key })).status).toBe(401);
  });
  it("error body uses the documented shape", async () => {
    const { req } = setup();
    const res = await req("/v1/me");
    expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });
});
