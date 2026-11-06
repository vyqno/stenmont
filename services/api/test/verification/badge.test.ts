import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensNames, merchants, tierBadges, worldEnrollments } from "../../src/db/schema";
import { publishTierBadge, runTierBadges } from "../../src/verification/badge";
import { recordVerification } from "../../src/verification/store";
import { RESOLVER } from "../helpers/ens";
import { seedMerchant, setup } from "../helpers/app";
import { dbOf } from "../helpers/fixtures";

type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as any;
async function named(t: T, id = "m_1", name = "acme.stenmont.eth", status = "active") {
  const db = dbOf(t.db);
  await db.insert(ensNames).values({ merchantId: id, label: name.split(".")[0]!, name, resolver: RESOLVER, agentRegistry: "0x5555555555555555555555555555555555555555", status, createdAt: "2026-11-01T00:00:00Z" });
}
const world = (t: T, id = "m_1") => dbOf(t.db).insert(worldEnrollments).values({ id: `w_${id}`, merchantId: id, action: "enrol-business-v2", nullifier: `n_${id}`, verifiedAt: "2026-11-01T00:00:00Z" });
const publish = (t: T, id = "m_1") => publishTierBadge({ db: dbOf(t.db), ens: t.ens, now: t.clock.now }, id);

describe("publishTierBadge", () => {
  it("does nothing for a business without an active name", async () => {
    const t = setup();
    await seedMerchant(t.db);
    expect(await publish(t)).toMatchObject({ status: "no_name" });
    await named(t, "m_1", "acme.stenmont.eth", "claiming");
    expect(await publish(t)).toMatchObject({ status: "no_name" });
    expect(t.ens.tierWrites).toHaveLength(0);
  });
  it("does not spend a transaction to say tier 0 when nothing was ever published", async () => {
    const t = setup();
    await seedMerchant(t.db);
    await named(t);
    expect(await publish(t)).toMatchObject({ status: "unchanged", tier: 0 });
    expect(t.ens.tierWrites).toHaveLength(0);
  });
  it("publishes the tier to the business's resolver, records it and audits it", async () => {
    const t = setup();
    await seedMerchant(t.db);
    await named(t);
    await world(t);
    const r = await publish(t);
    expect(r).toMatchObject({ status: "published", tier: 3 });
    expect(t.ens.tierWrites).toEqual([{ name: "acme.stenmont.eth", resolver: RESOLVER, tier: 3 }]);
    expect(await dbOf(t.db).select().from(tierBadges)).toMatchObject([{ merchantId: "m_1", publishedTier: 3 }]);
    const a = await t.db.prepare("select actor, payload from audit_log where action = 'verification.badge_published'").all();
    expect(a.results).toHaveLength(1);
  });
  it("is idempotent: the same tier is not written twice", async () => {
    const t = setup();
    await seedMerchant(t.db);
    await named(t);
    await world(t);
    await publish(t);
    expect(await publish(t)).toMatchObject({ status: "unchanged", tier: 3 });
    expect(t.ens.tierWrites).toHaveLength(1);
  });
  it("follows the tier up, and back down when a record expires", async () => {
    const t = setup();
    await seedMerchant(t.db);
    await named(t);
    await world(t);
    await publish(t);
    await recordVerification(dbOf(t.db), { merchantId: "m_1", method: "kyc", provider: "mock", reference: "r", decision: "approved", decidedAt: t.clock.now, expiresAt: new Date(t.clock.now.getTime() + 3_600_000) });
    expect(await publish(t)).toMatchObject({ status: "published", tier: 4 });
    t.clock.now = new Date(t.clock.now.getTime() + 3_600_001);
    expect(await publish(t)).toMatchObject({ status: "published", tier: 3 });
    expect(t.ens.tierWrites.map((w) => w.tier)).toEqual([3, 4, 3]);
  });
  it("reports a failed write without throwing and tries again next time", async () => {
    const t = setup();
    await seedMerchant(t.db);
    await named(t);
    await world(t);
    let fail = true;
    t.ens.setTierRecord = async (a) => {
      if (fail) throw new Error("revert: no role");
      t.ens.tierWrites.push(a);
      return `0x${"01".repeat(32)}`;
    };
    expect(await publish(t)).toMatchObject({ status: "failed", tier: 3 });
    expect(await dbOf(t.db).select().from(tierBadges)).toHaveLength(0);
    expect(((await t.db.prepare("select count(*) as n from audit_log where action = 'verification.badge_failed'").first()) as { n: number }).n).toBe(1);
    fail = false;
    expect(await publish(t)).toMatchObject({ status: "published", tier: 3 });
  });
});

describe("runTierBadges (the hourly job)", () => {
  async function three() {
    const t = setup();
    for (const [i, id] of ["m_1", "m_2", "m_3"].entries()) {
      await seedMerchant(t.db, id, `Biz ${i}`, `sk_test_${String(i).repeat(32)}`);
      await named(t, id, `biz${i}.stenmont.eth`);
    }
    return t;
  }
  it("writes only the names whose tier changed", async () => {
    const t = await three();
    await world(t, "m_1");
    await world(t, "m_3");
    const res = await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now });
    expect(res).toEqual({ published: 2, failed: 0 });
    expect(t.ens.tierWrites.map((w) => w.name).sort()).toEqual(["biz0.stenmont.eth", "biz2.stenmont.eth"]);
    expect(await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now })).toEqual({ published: 0, failed: 0 });
  });
  it("stops after its per-run limit and carries on next run", async () => {
    const t = await three();
    for (const id of ["m_1", "m_2", "m_3"]) await world(t, id);
    expect(await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now }, 2)).toEqual({ published: 2, failed: 0 });
    expect(await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now }, 2)).toEqual({ published: 1, failed: 0 });
  });
  it("one failure does not stop the others", async () => {
    const t = await three();
    for (const id of ["m_1", "m_2", "m_3"]) await world(t, id);
    const real = t.ens.setTierRecord;
    t.ens.setTierRecord = async (a) => {
      if (a.name === "biz1.stenmont.eth") throw new Error("boom");
      return real(a);
    };
    expect(await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now })).toEqual({ published: 2, failed: 1 });
  });
  it("skips a business that is suspended", async () => {
    const t = await three();
    await world(t, "m_1");
    await dbOf(t.db).update(merchants).set({ status: "pending" }).where(eq(merchants.id, "m_1"));
    expect(await runTierBadges({ db: dbOf(t.db), ens: t.ens, now: t.clock.now })).toEqual({ published: 0, failed: 0 });
  });
});

describe("POST /v1/verification/badge/publish", () => {
  it("publishes the signed-in business's tier on request, and limits how often", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await named(t);
    await world(t);
    const res = await t.req("/v1/verification/badge/publish", { method: "POST", key, body: "{}" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "published", tier: 3 });
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await t.req("/v1/verification/badge/publish", { method: "POST", key, body: "{}" })).status);
    expect(codes.at(-1)).toBe(429);
  });
  it("shows the published badge in the verification status", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await named(t);
    await world(t);
    await t.req("/v1/verification/badge/publish", { method: "POST", key, body: "{}" });
    const s = await json(await t.req("/v1/verification", { key }));
    expect(s.badge).toMatchObject({ name: "acme.stenmont.eth", publishedTier: 3 });
  });
});
