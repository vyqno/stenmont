import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LIMITS_KEY, PAY_KEY, TOKEN_KEY, X402_KEY, parseLimitsRecord, toUnits } from "@stenmont/shared";
import { ensDirectory, ensNames, siteChecks, sites, worldEnrollments } from "../../src/db/schema";
import { runDirectoryRefresh } from "../../src/ens/publishDirectory";
import { seedMerchant, setup } from "../helpers/app";
import { RESOLVER } from "../helpers/ens";
import { dbOf } from "../helpers/fixtures";

type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as any;
const NAME = "acme.stenmont.eth";

async function world(opts: { name?: boolean; verified?: boolean } = {}) {
  const { name = true, verified = true } = opts;
  const t = setup();
  const key = await seedMerchant(t.db);
  const db = dbOf(t.db);
  if (name) await db.insert(ensNames).values({ merchantId: "m_1", label: "acme", name: NAME, resolver: RESOLVER, agentRegistry: "0x5555555555555555555555555555555555555555", status: "active", createdAt: "2026-11-01T00:00:00Z" });
  if (verified) {
    await db.insert(sites).values({ id: "s_1", merchantId: "m_1", url: "https://acme.example", host: "acme.example", token: "tok", createdAt: "2026-11-01T00:00:00Z" });
    await db.insert(siteChecks).values({ siteId: "s_1", kind: "domain", ok: 1, detail: "ok", checkedAt: "2026-11-01T00:00:00Z" });
  }
  return { t, key, db };
}
const publish = (t: T, key: string, body: unknown = {}, idem: string = crypto.randomUUID()) => t.req("/v1/ens/directory/publish", { method: "POST", key, idem, body: JSON.stringify(body) });
const audits = async (t: T, action: string) => (await t.db.prepare("select payload from audit_log where action = ?").bind(action).all()).results;

describe("POST /v1/ens/directory/publish", () => {
  it("needs the Idempotency-Key and a signed-in business", async () => {
    const { t, key } = await world();
    expect((await t.req("/v1/ens/directory/publish", { method: "POST", key, body: "{}" })).status).toBe(400);
    expect((await t.req("/v1/ens/directory/publish", { method: "POST", idem: "x", body: "{}" })).status).toBe(401);
  });
  it("answers 404 for a business without a name", async () => {
    const { t, key } = await world({ name: false });
    expect((await publish(t, key)).status).toBe(404);
    expect(t.ens.textWrites).toHaveLength(0);
  });
  it("writes the derived records, and the business's own links when their host is verified", async () => {
    const { t, key } = await world();
    const r = await publish(t, key, { payUrl: "https://pay.acme.example/checkout", x402Url: "https://api.acme.example/premium", refund: "Refunds within 14 days" });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toMatchObject({ status: "published", name: NAME, omitted: [] });
    expect(t.ens.textWrites).toHaveLength(1);
    const w = t.ens.textWrites[0]!;
    expect(w).toMatchObject({ name: NAME, resolver: RESOLVER });
    expect(w.records[PAY_KEY]).toBe("https://pay.acme.example/checkout");
    expect(w.records[X402_KEY]).toBe("https://api.acme.example/premium");
    expect(w.records[TOKEN_KEY]).toBe("eip155:1874/erc20:0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
    // a business with a verified domain but no other proof is tier 2: the cap is that tier's
    expect(parseLimitsRecord(w.records[LIMITS_KEY]!)).toEqual({ perInvoice: toUnits("2000") });
    expect(await audits(t, "ens.directory_published")).toHaveLength(1);
    expect(await audits(t, "ens.directory_published").then((a) => JSON.parse((a[0] as any).payload))).toMatchObject({ name: NAME });
  });
  it("leaves out, and says why, any link whose host the business has not proved", async () => {
    const { t, key } = await world();
    const body = await json(await publish(t, key, { payUrl: "https://elsewhere.example/pay" }));
    expect(body.omitted).toEqual([{ key: PAY_KEY, reason: "host_not_verified" }]);
    expect(t.ens.textWrites[0]!.records[PAY_KEY]).toBeUndefined();
  });
  it("publishes only the derived records for a business with no verified domain", async () => {
    const { t, key } = await world({ verified: false });
    const body = await json(await publish(t, key, { payUrl: "https://pay.acme.example/c" }));
    expect(body.status).toBe("published");
    expect(Object.keys(t.ens.textWrites[0]!.records).sort()).toEqual([LIMITS_KEY, TOKEN_KEY]);
    expect(body.omitted).toEqual([{ key: PAY_KEY, reason: "host_not_verified" }]);
  });
  it("is idempotent: the same Idempotency-Key replays the answer, a new key with the same content writes nothing", async () => {
    const { t, key } = await world();
    const first = await publish(t, key, { payUrl: "https://pay.acme.example/c" }, "same");
    const replay = await publish(t, key, { payUrl: "https://pay.acme.example/c" }, "same");
    expect(await json(replay)).toEqual(await json(first));
    expect(t.ens.textWrites).toHaveLength(1);
    const again = await json(await publish(t, key, {}));
    expect(again.status).toBe("unchanged");
    expect(t.ens.textWrites).toHaveLength(1);
    expect(await audits(t, "ens.directory_published")).toHaveLength(1);
  });
  it("remembers what was set, writes only what changed, and blanks a record that was cleared", async () => {
    const { t, key } = await world();
    await publish(t, key, { payUrl: "https://pay.acme.example/c", x402Url: "https://api.acme.example/p" });
    await publish(t, key, { payUrl: "https://pay.acme.example/d" });
    expect(t.ens.textWrites[1]!.records).toEqual({ [PAY_KEY]: "https://pay.acme.example/d" });
    await publish(t, key, { x402Url: null });
    expect(t.ens.textWrites[2]!.records).toEqual({ [X402_KEY]: "" });
    const [row] = await dbOf(t.db).select().from(ensDirectory).where(eq(ensDirectory.merchantId, "m_1"));
    expect(JSON.parse(row!.published)[X402_KEY]).toBeUndefined();
    expect(JSON.parse(row!.published)[PAY_KEY]).toBe("https://pay.acme.example/d");
  });
  it("rejects unknown fields and oversized input", async () => {
    const { t, key } = await world();
    expect((await publish(t, key, { token: "DAI" })).status).toBe(400);
    expect((await publish(t, key, { payUrl: "x".repeat(3000) })).status).toBe(400);
    expect(t.ens.textWrites).toHaveLength(0);
  });
  it("reports a chain failure without recording it as published, and keeps what the business entered", async () => {
    const { t, key, db } = await world();
    t.ens.setTextRecords = async () => {
      throw new Error("revert");
    };
    const r = await publish(t, key, { payUrl: "https://pay.acme.example/c" });
    expect(r.status).toBe(502);
    expect(await audits(t, "ens.directory_failed")).toHaveLength(1);
    const [row] = await db.select().from(ensDirectory);
    expect(row).toMatchObject({ payUrl: "https://pay.acme.example/c", published: "{}", txHash: null });
  });
  it("is scoped to the signed-in business", async () => {
    const { t } = await world();
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await publish(t, other, { payUrl: "https://pay.acme.example/c" })).status).toBe(404);
    expect(t.ens.textWrites).toHaveLength(0);
  });
});

describe("GET /v1/ens/directory", () => {
  it("shows the saved inputs, what would be published and what was left out", async () => {
    const { t, key } = await world();
    await publish(t, key, { payUrl: "https://pay.acme.example/c", refund: "x".repeat(300) });
    const body = await json(await t.req("/v1/ens/directory", { key }));
    expect(body.inputs).toEqual({ payUrl: "https://pay.acme.example/c", x402Url: null, refund: "x".repeat(300) });
    expect(body.records[PAY_KEY]).toBe("https://pay.acme.example/c");
    expect(body.omitted).toEqual([{ key: "stenmont.refund", reason: "too_long" }]);
    expect(body.published[TOKEN_KEY]).toBeTruthy();
  });
  it("answers 404 before the first publish", async () => {
    const { t, key } = await world();
    expect((await t.req("/v1/ens/directory", { key })).status).toBe(404);
  });
});

describe("runDirectoryRefresh (hourly)", () => {
  const deps = (t: T) => ({ db: dbOf(t.db), ens: t.ens, now: t.clock.now, chainId: 1874, usdt: t.env.USDT_ADDRESS as `0x${string}` });
  it("does nothing for a business that never published", async () => {
    const { t } = await world();
    expect(await runDirectoryRefresh(deps(t))).toEqual({ published: 0, failed: 0 });
    expect(t.ens.textWrites).toHaveLength(0);
  });
  it("follows the tier: when the cap changes the new cap is written, and only the cap", async () => {
    const { t, key, db } = await world();
    await publish(t, key, { payUrl: "https://pay.acme.example/c" });
    expect(await runDirectoryRefresh(deps(t))).toEqual({ published: 0, failed: 0 });
    await db.insert(worldEnrollments).values({ id: "w_1", merchantId: "m_1", action: "enrol-business", nullifier: "n1", verifiedAt: "2026-11-01T00:00:00Z" });
    expect(await runDirectoryRefresh(deps(t))).toEqual({ published: 1, failed: 0 });
    const last = t.ens.textWrites.at(-1)!;
    expect(Object.keys(last.records)).toEqual([LIMITS_KEY]);
    expect(parseLimitsRecord(last.records[LIMITS_KEY]!)).toEqual({ perInvoice: toUnits("10000") });
  });
  it("counts a chain failure and carries on with the next business", async () => {
    const { t, key } = await world();
    await publish(t, key, {});
    await dbOf(t.db).insert(worldEnrollments).values({ id: "w_1", merchantId: "m_1", action: "enrol-business", nullifier: "n1", verifiedAt: "2026-11-01T00:00:00Z" });
    t.ens.setTextRecords = async () => {
      throw new Error("down");
    };
    expect(await runDirectoryRefresh(deps(t))).toEqual({ published: 0, failed: 1 });
  });
});
