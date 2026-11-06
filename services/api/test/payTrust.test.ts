import { describe, expect, it } from "vitest";
import { ensNames, siteChecks, sites, verificationRecords, worldEnrollments } from "../src/db/schema";
import { publicTrust } from "../src/verification/publicTrust";
import { seedMerchant, setup } from "./helpers/app";
import { RESOLVER } from "./helpers/ens";
import { dbOf } from "./helpers/fixtures";

type T = ReturnType<typeof setup>;
const NOW = new Date("2026-11-06T12:00:00Z");
const create = (t: T, key: string) => t.req("/v1/invoices", { method: "POST", key, idem: crypto.randomUUID(), body: JSON.stringify({ amount: "5", number: "INV-1", customerEmail: "secret@x.co" }) });
const body = async (t: T, id: string) => (await (await t.req(`/pay/${id}`)).json()) as any;

async function biz() {
  const t = setup();
  const key = await seedMerchant(t.db);
  return { t, key, db: dbOf(t.db) };
}
const withName = (db: ReturnType<typeof dbOf>, status = "active") =>
  db.insert(ensNames).values({ merchantId: "m_1", label: "acme", name: "acme.stenmont.eth", resolver: RESOLVER, agentRegistry: "0x5555555555555555555555555555555555555555", status, createdAt: "2026-11-01T00:00:00Z" });
const withSite = async (db: ReturnType<typeof dbOf>, ok: number) => {
  await db.insert(sites).values({ id: "s_1", merchantId: "m_1", url: "https://acme.example", host: "acme.example", token: "tok", createdAt: "2026-11-01T00:00:00Z" });
  await db.insert(siteChecks).values({ siteId: "s_1", kind: "domain", ok, detail: "x", checkedAt: "2026-11-01T00:00:00Z" });
};
const withWorld = (db: ReturnType<typeof dbOf>) => db.insert(worldEnrollments).values({ id: "w_1", merchantId: "m_1", action: "enrol-business-v2", nullifier: "n1", verifiedAt: "2026-11-01T00:00:00Z" });
const withRecord = (db: ReturnType<typeof dbOf>, method: string, expiresAt: string | null = null) =>
  db.insert(verificationRecords).values({ id: crypto.randomUUID(), merchantId: "m_1", tier: 2, method, decision: "approved", decidedAt: "2026-11-01T00:00:00Z", expiresAt });

describe("the public pay view's trust block", () => {
  it("is all false for a business that has proved nothing", async () => {
    const { t, key } = await biz();
    const inv = (await (await create(t, key)).json()) as { id: string };
    expect((await body(t, inv.id)).trust).toEqual({ domain: false, world: false, ensName: null, tier: 0 });
  });
  it("shows every proof that holds", async () => {
    const { t, key, db } = await biz();
    await withName(db);
    await withSite(db, 1);
    await withWorld(db);
    const inv = (await (await create(t, key)).json()) as { id: string };
    expect((await body(t, inv.id)).trust).toEqual({ domain: true, world: true, ensName: "acme.stenmont.eth", tier: 3 });
  });
  it("does not count a failed domain check, a name still being claimed, or an expired domain record", async () => {
    const { t, key, db } = await biz();
    await withName(db, "claiming");
    await withSite(db, 0);
    await withRecord(db, "domain", "2026-11-01T00:00:00Z");
    const inv = (await (await create(t, key)).json()) as { id: string };
    expect((await body(t, inv.id)).trust).toEqual({ domain: false, world: false, ensName: null, tier: 0 });
  });
  it("counts a live domain record from another route (for example a proven workspace domain)", async () => {
    const { t, key, db } = await biz();
    await withRecord(db, "domain");
    const inv = (await (await create(t, key)).json()) as { id: string };
    expect((await body(t, inv.id)).trust).toMatchObject({ domain: true, world: false, tier: 2 });
  });
  it("exposes nothing private: no email, id, address, nullifier, site or token", async () => {
    const { t, key, db } = await biz();
    await withName(db);
    await withSite(db, 1);
    await withWorld(db);
    const inv = (await (await create(t, key)).json()) as { id: string };
    const text = JSON.stringify(await body(t, inv.id));
    for (const secret of ["secret@x.co", "m_1", "n1", "tok", "acme.example", "0x50c94c3021962047F10c9c58D80C4A7b73182a63", RESOLVER]) expect(text).not.toContain(secret);
    expect(Object.keys((await body(t, inv.id)).trust).sort()).toEqual(["domain", "ensName", "tier", "world"]);
  });
});

describe("publicTrust", () => {
  it("is scoped to the business asked about", async () => {
    const { t, db } = await biz();
    await withWorld(db);
    await seedMerchant(t.db, "m_2", "Other", `sk_test_${"c".repeat(32)}`);
    expect(await publicTrust(db, "m_2", NOW)).toEqual({ domain: false, world: false, ensName: null, tier: 0 });
    expect(await publicTrust(db, "m_1", NOW)).toMatchObject({ world: true });
  });
});
