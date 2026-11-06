import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { gasTanks, subscriptions, webhookDeliveries, webhookEndpoints } from "../src/db/schema";
import { runPreflight } from "../src/preflight";
import { runRenewals } from "../src/renewals";
import { baseEnv, seedMerchant, setup } from "./helpers/app";
import { dbOf, fakeQueue, seedEndpoint } from "./helpers/fixtures";

const PAYER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-11-06T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const DAY = 86_400;

/** An active subscription (9.99 USDT) whose next charge is due `inSeconds` from now, with the payer's balance and allowance as given. */
async function world(opts: { inSeconds?: number; balance?: bigint; allowance?: bigint; kind?: string; maxCharges?: number } = {}) {
  const { inSeconds = 3_600, balance = 50_000_000n, allowance = 50_000_000n } = opts;
  const reads: string[] = [];
  const t = setup({
    async usdtBalance() { reads.push("balance"); return state.balance; },
    async usdtAllowance() { reads.push("allowance"); return state.allowance; },
  });
  const state = { balance, allowance };
  await seedMerchant(t.db);
  await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const db = dbOf(t.db);
  await db.insert(gasTanks).values({ merchantId: "m_1", wbtBalance: (10n ** 17n).toString(), dailyCapWbt: (10n ** 17n).toString(), spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
  await seedEndpoint(t.db);
  await seedEndpoint(t.db, { merchantId: "m_2", url: "https://other.example/h" });
  await db.insert(subscriptions).values({
    id: `0x${"ab".repeat(32)}`, merchantId: "m_1", amount: "9990000", periodSeconds: 2_592_000, maxCharges: opts.maxCharges ?? 12, startAt: NOW_S - 100, customerEmail: null, payer: PAYER,
    status: "active", charges: 1, nextChargeAt: NOW_S + inSeconds, failedAttempts: 0, retryAt: null, subscribeTx: null, kind: opts.kind ?? "subscription",
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  });
  const q = fakeQueue();
  const env = { ...baseEnv(t.db), WEBHOOKS: q } as unknown as ReturnType<typeof baseEnv>;
  const run = (now = NOW) => runPreflight(env, db, t.chain, now);
  const row = async () => (await db.select().from(subscriptions))[0]!;
  const events = async (type = "subscription.at_risk") => (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.type, type))).map((d) => ({ merchant: d.endpointId, ...JSON.parse(d.payload) }));
  return { t, db, state, reads, run, row, events, env };
}

describe("renewal pre-flight", () => {
  it("flags a charge due within a day that the payer's balance cannot cover, and tells the business once", async () => {
    const w = await world({ balance: 5_000_000n });
    expect(await w.run()).toEqual({ checked: 1, atRisk: 1 });
    expect(await w.row()).toMatchObject({ atRiskReason: "balance", atRiskAt: NOW.toISOString() });
    const [e] = await w.events();
    expect(e.data).toMatchObject({ reason: "balance", subscription: { id: `0x${"ab".repeat(32)}`, kind: "subscription", payer: PAYER }, charge: { number: 2, of: 12, amount: "9.99", dueAt: new Date((NOW_S + 3_600) * 1000).toISOString() } });
    await w.run(new Date(NOW.getTime() + 3_600_000));
    expect(await w.events()).toHaveLength(1); // the same upcoming charge is never announced twice
  });
  it("flags an allowance that is too small even when the balance is fine", async () => {
    const w = await world({ allowance: 1_000_000n });
    await w.run();
    expect(await w.row()).toMatchObject({ atRiskReason: "allowance" });
    expect((await w.events())[0]!.data.reason).toBe("allowance");
  });
  it("leaves a payer who can cover the charge alone, and clears the flag once they top up", async () => {
    const w = await world();
    expect(await w.run()).toEqual({ checked: 1, atRisk: 0 });
    expect((await w.row()).atRiskReason).toBeNull();
    w.state.balance = 0n;
    await w.run();
    expect((await w.row()).atRiskReason).toBe("balance");
    w.state.balance = 50_000_000n;
    await w.run();
    expect(await w.row()).toMatchObject({ atRiskReason: null, atRiskAt: null });
  });
  it("only looks one day ahead, and skips ones that are not active", async () => {
    const far = await world({ inSeconds: 2 * DAY, balance: 0n });
    expect(await far.run()).toEqual({ checked: 0, atRisk: 0 });
    expect(far.reads).toHaveLength(0);
    const late = await world({ inSeconds: -10, balance: 0n }); // already due: the charge itself is the check
    expect(await late.run()).toEqual({ checked: 0, atRisk: 0 });
    const done = await world({ balance: 0n });
    await done.db.update(subscriptions).set({ status: "cancelled" });
    expect(await done.run()).toEqual({ checked: 0, atRisk: 0 });
  });
  it("does not flag anyone when the chain cannot be read", async () => {
    const w = await world({ balance: 0n });
    w.t.chain.usdtBalance = async () => { throw new Error("rpc down"); };
    expect(await w.run()).toEqual({ checked: 1, atRisk: 0 });
    expect((await w.row()).atRiskReason).toBeNull();
    expect(await w.events()).toHaveLength(0);
  });
  it("covers instalment plans too, and sends the event only to the business that owns them", async () => {
    const w = await world({ kind: "instalment", balance: 0n, maxCharges: 3 });
    await w.run();
    const [e] = await w.events();
    expect(e.data.subscription.kind).toBe("instalment");
    const deliveries = await w.db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    const [ep] = await w.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, deliveries[0]!.endpointId));
    expect(ep!.merchantId).toBe("m_1");
  });
  it("never blocks the charge: a flagged subscription is still charged when due, and the flag clears", async () => {
    const w = await world({ balance: 0n });
    await w.run();
    expect((await w.row()).atRiskReason).toBe("balance");
    w.t.chain.subscriptionState = async () => ({ nextCharge: BigInt(NOW_S + 2_592_000), charges: 2, status: "active" as const });
    await w.db.update(subscriptions).set({ nextChargeAt: NOW_S - 1 });
    expect(await runRenewals(w.env, w.db, w.t.chain, NOW)).toEqual({ charged: 1, failed: 0 });
    expect(await w.row()).toMatchObject({ charges: 2, atRiskReason: null, atRiskAt: null });
  });
});
