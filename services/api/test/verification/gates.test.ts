import { describe, expect, it } from "vitest";
import { toUnits } from "@stenmont/shared";
import { siteChecks, sites, verificationLimits, worldEnrollments } from "../../src/db/schema";
import { recordVerification } from "../../src/verification/store";
import { DEMO_LIMITS } from "../../src/verification/tiers";
import { seedMerchant, setup } from "../helpers/app";
import { dbOf } from "../helpers/fixtures";

type T = ReturnType<typeof setup>;
const fmt = (n: bigint) => (Number(n) / 1e6).toString();
const create = (t: T, key: string, amount: string, idem = crypto.randomUUID()) => t.req("/v1/invoices", { method: "POST", key, idem, body: JSON.stringify({ amount }) });
const json = async (r: Response) => (await r.json()) as any;
const T0 = DEMO_LIMITS[0]!;

async function tierUp(t: T, tier: 1 | 2 | 3 | 4, merchantId = "m_1") {
  const db = dbOf(t.db);
  if (tier === 1) await recordVerification(db, { merchantId, method: "email", decision: "approved", decidedAt: t.clock.now });
  if (tier === 2) {
    await db.insert(sites).values({ id: "s1", merchantId, url: "https://acme.example", host: "acme.example", token: "t", createdAt: "2026-11-01T00:00:00Z" });
    await db.insert(siteChecks).values({ siteId: "s1", kind: "domain", ok: 1, detail: "ok", checkedAt: "2026-11-01T00:00:00Z" });
  }
  if (tier === 3) await db.insert(worldEnrollments).values({ id: "w1", merchantId, action: "enrol-business-v2", nullifier: "1", verifiedAt: "2026-11-01T00:00:00Z" });
  if (tier === 4) await recordVerification(db, { merchantId, method: "kyc", provider: "mock", reference: "r1", decision: "approved", decidedAt: t.clock.now });
}

describe("invoice creation is capped by tier", () => {
  it("accepts exactly the per-invoice cap at tier 0 and refuses a unit over with the next step", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await create(t, key, fmt(T0.perInvoice))).status).toBe(201);
    const res = await create(t, key, "100.000001");
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error.code).toBe("tier_limit");
    expect(body.error.details).toMatchObject({ reason: "per_invoice", currentTier: 0, nextTier: 1 });
    expect(body.error.details.howToReach).toMatch(/email/i);
    expect(t.chain.calls).toHaveLength(1); // the refused invoice never reached the chain
  });

  it("a refused invoice leaves no row behind", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await create(t, key, "100.000001");
    expect(((await t.db.prepare("select count(*) as n from invoices").first()) as { n: number }).n).toBe(0);
  });

  it("raises the cap when the tier rises, per tier", async () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const t = setup();
      const key = await seedMerchant(t.db);
      await tierUp(t, tier);
      const cap = DEMO_LIMITS[tier]!.perInvoice;
      expect((await create(t, key, fmt(cap))).status, `tier ${tier} at cap`).toBe(201);
      if (tier < 4) expect((await create(t, key, fmt(cap + 1n))).status, `tier ${tier} over cap`).toBe(403);
    }
  });

  it("enforces the rolling daily volume and counts only the last 24 hours", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    for (let i = 0; i < 5; i++) expect((await create(t, key, "100")).status).toBe(201); // 500 = the tier 0 daily cap
    const res = await create(t, key, "0.000001");
    expect(res.status).toBe(403);
    expect((await json(res)).error.details).toMatchObject({ reason: "daily_volume", currentTier: 0 });
    // invoices are stamped with the real clock, so age them in the table rather than moving the fake clock
    await t.db.prepare("update invoices set created_at = ?").bind(new Date(t.clock.now.getTime() - 24 * 3_600_000 - 1000).toISOString()).run();
    expect((await create(t, key, "100")).status).toBe(201);
  });

  it("does not count failed invoices towards the daily volume", async () => {
    const t = setup({ async createInvoice() { throw new Error("rpc"); } });
    const key = await seedMerchant(t.db);
    for (let i = 0; i < 6; i++) expect((await create(t, key, "100")).status).toBe(502);
  });

  it("falls back to a lower tier when the record expires (downgrade)", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await recordVerification(dbOf(t.db), { merchantId: "m_1", method: "kyc", provider: "mock", reference: "r1", decision: "approved", decidedAt: t.clock.now, expiresAt: new Date(t.clock.now.getTime() + 60_000) });
    expect((await create(t, key, "1000")).status).toBe(201);
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    const res = await create(t, key, "1000");
    expect(res.status).toBe(403);
    expect((await json(res)).error.details.currentTier).toBe(0);
  });

  it("reads overrides from the limits table", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await dbOf(t.db).insert(verificationLimits).values({ tier: 0, perInvoice: toUnits("5").toString(), dailyVolume: toUnits("500").toString(), financingCap: "0", investor: 0, updatedAt: "x" });
    expect((await create(t, key, "6")).status).toBe(403);
    expect((await create(t, key, "5")).status).toBe(201);
  });

  it("applies the same cap to store checkout (it uses the same invoice code)", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const product = await json(await t.req("/v1/products", { method: "POST", key, body: JSON.stringify({ title: "Big", status: "active", variants: [{ price: "150", inventory: 5, trackInventory: true }] }) }));
    const res = await t.req("/v1/store/checkout", { method: "POST", key, idem: "c1", body: JSON.stringify({ items: [{ variantId: product.variants[0].id, quantity: 1 }] }) });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("tier_limit");
    const stock = (await t.db.prepare("select inventory from variants").first()) as { inventory: number };
    expect(stock.inventory).toBe(5); // the held stock was given back
  });
});
