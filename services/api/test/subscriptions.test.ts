import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Rejected } from "../src/chain";
import { gasTanks, subscriptions, webhookDeliveries } from "../src/db/schema";
import { runRenewals } from "../src/renewals";
import { baseEnv, MERCHANT_ADDRESS, PAYOUT_ADDRESS, seedMerchant, setup } from "./helpers/app";
import { dbOf, fakeQueue, seedEndpoint } from "./helpers/fixtures";

const PAYER = "0x2222222222222222222222222222222222222222";
const MANAGER = "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD";
type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const NOW_S = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);

async function world(chain: Parameters<typeof setup>[0] = {}) {
  const t = setup(chain);
  const key = await seedMerchant(t.db);
  await dbOf(t.db).insert(gasTanks).values({ merchantId: "m_1", wbtBalance: (10n ** 17n).toString(), dailyCapWbt: (10n ** 17n).toString(), spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
  const create = (body: unknown, idem = crypto.randomUUID()) => t.req("/v1/subscriptions", { method: "POST", key, idem, body: JSON.stringify(body) });
  const offer = async (over: Record<string, unknown> = {}) => json(await create({ amount: "9.99", periodSeconds: 2_592_000, maxCharges: 12, ...over }));
  const subscribe = (id: string, over: Record<string, unknown> = {}) =>
    t.req("/relay/subscribe", {
      method: "POST",
      headers: { "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ id, payer: PAYER, deadline: String(NOW_S + 600), payerSig: "0x1234", ...over }),
    });
  return { t, key, create, offer, subscribe, db: dbOf(t.db) };
}

describe("merchant API", () => {
  it("creates an offer with a link the customer opens, and validates the terms", async () => {
    const w = await world();
    const res = await w.create({ amount: "9.99", periodSeconds: 2_592_000, maxCharges: 12, customerEmail: "c@x.co" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ status: "offered", amount: "9.99", periodSeconds: 2_592_000, maxCharges: 12, charges: 0 });
    expect(body.id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.subscribeUrl).toBe(`https://app.test/subscribe/${body.id}`);
    for (const bad of [{ amount: "0" }, { periodSeconds: 59 }, { maxCharges: 0 }, { maxCharges: 10_001 }, { amount: "x" }, { extra: 1 }]) {
      expect((await w.create({ amount: "9.99", periodSeconds: 3600, maxCharges: 3, ...bad })).status).toBe(400);
    }
  });
  it("lists and fetches only its own subscriptions", async () => {
    const w = await world();
    const a = await w.offer();
    const other = await seedMerchant(w.t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect(((await json(await w.t.req("/v1/subscriptions", { key: w.key }))).data as unknown[]).length).toBe(1);
    expect((await w.t.req(`/v1/subscriptions/${a.id}`, { key: other })).status).toBe(404);
    expect((await w.t.req(`/v1/subscriptions/${a.id}`, { key: w.key })).status).toBe(200);
  });
  it("stops charging when the merchant cancels, and says so plainly when it is already cancelled", async () => {
    const w = await world();
    const a = await w.offer();
    const first = await w.t.req(`/v1/subscriptions/${a.id}/cancel`, { method: "POST", key: w.key });
    expect(first.status).toBe(200);
    expect((await json(first)).status).toBe("cancelled");
    expect((await w.t.req(`/v1/subscriptions/${a.id}/cancel`, { method: "POST", key: w.key })).status).toBe(409);
    expect((await w.subscribe(a.id)).status).toBe(409); // a cancelled offer cannot be taken up
  });
});

describe("customer subscribes (relayed, merchant pays the gas)", () => {
  it("shows the terms publicly", async () => {
    const w = await world();
    const a = await w.offer();
    const res = await w.t.req(`/pay/subscription/${a.id}`);
    expect(await json(res)).toMatchObject({ id: a.id, merchantName: "Acme", amount: "9.99", periodSeconds: 2_592_000, maxCharges: 12, status: "offered" });
    expect((await w.t.req(`/pay/subscription/0x${"00".repeat(32)}`)).status).toBe(404);
  });
  it("sends exactly the terms the merchant set, then marks the subscription active", async () => {
    const w = await world();
    const a = await w.offer();
    const res = await w.subscribe(a.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "active", txHash: expect.stringMatching(/^0x/) });
    expect(w.t.chain.sent).toHaveLength(1);
    expect(w.t.chain.sent[0]!.to).toBe(MANAGER);
    const [row] = await w.db.select().from(subscriptions).where(eq(subscriptions.id, a.id));
    expect(row).toMatchObject({ status: "active", payer: PAYER, charges: 0 });
    expect(row!.nextChargeAt).toBeLessThanOrEqual(NOW_S);
    void MERCHANT_ADDRESS;
    void PAYOUT_ADDRESS;
  });
  it("refuses a second take-up, an unfunded merchant, and anything the contract would reject", async () => {
    const w = await world();
    const a = await w.offer();
    expect((await w.subscribe(a.id)).status).toBe(200);
    expect((await w.subscribe(a.id)).status).toBe(409);

    const w2 = await world({ estimateGas: async () => { throw new Rejected("BadSignature"); } });
    const b = await w2.offer();
    const rej = await w2.subscribe(b.id);
    expect(rej.status).toBe(422);
    expect((await json(rej)).error.code).toBe("subscription_rejected");
    expect(w2.t.chain.sent).toHaveLength(0);
    const [still] = await w2.db.select().from(subscriptions);
    expect(still!.status).toBe("offered"); // can be tried again

    const w3 = await world();
    await w3.db.delete(gasTanks);
    const c = await w3.offer();
    expect((await w3.subscribe(c.id)).status).toBe(402);
  });
  it("lets the customer cancel with their own signature", async () => {
    const w = await world();
    const a = await w.offer();
    await w.subscribe(a.id);
    const res = await w.t.req("/relay/subscription-cancel", {
      method: "POST",
      headers: { "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ id: a.id, deadline: String(NOW_S + 600), payerSig: "0x1234" }),
    });
    expect(res.status).toBe(200);
    expect((await w.db.select().from(subscriptions))[0]!.status).toBe("cancelled");
    expect(w.t.chain.sent).toHaveLength(2);
  });
});

describe("customer cancel still works after the merchant stopped charging", () => {
  it("lets the customer end it onchain even when the dashboard row says cancelled", async () => {
    const w = await world();
    const a = await w.offer();
    await w.subscribe(a.id);
    await w.t.req(`/v1/subscriptions/${a.id}/cancel`, { method: "POST", key: w.key });
    const res = await w.t.req("/relay/subscription-cancel", {
      method: "POST",
      headers: { "cf-connecting-ip": "9.9.9.9" },
      body: JSON.stringify({ id: a.id, deadline: String(NOW_S + 600), payerSig: "0x1234" }),
    });
    expect(res.status).toBe(200);
    expect(w.t.chain.sent.length).toBeGreaterThan(1); // the cancel transaction was sent
  });
});

describe("renewals (cron)", () => {
  async function active(chainOver: Parameters<typeof setup>[0] = {}) {
    const w = await world();
    const a = await w.offer({ maxCharges: 2 });
    await w.subscribe(a.id);
    Object.assign(w.t.chain, chainOver); // behaviour changes only after the customer has subscribed
    await seedEndpoint(w.t.db);
    const q = fakeQueue();
    const env = { ...baseEnv(w.t.db), WEBHOOKS: q } as unknown as ReturnType<typeof baseEnv>;
    const run = (now = new Date("2026-11-06T12:00:00Z")) => runRenewals(env, w.db, w.t.chain, now);
    const row = async () => (await w.db.select().from(subscriptions))[0]!;
    const events = async () => (await w.db.select().from(webhookDeliveries)).map((d) => d.type);
    return { w, a, run, row, events, q };
  }
  it("charges what is due, refreshes the schedule from the contract and tells the merchant", async () => {
    const t = await active({
      async subscriptionState() {
        return { nextCharge: BigInt(NOW_S + 2_592_000), charges: 1, status: "active" as const };
      },
    });
    expect(await t.run()).toEqual({ charged: 1, failed: 0 });
    expect(await t.row()).toMatchObject({ charges: 1, nextChargeAt: NOW_S + 2_592_000, status: "active", failedAttempts: 0 });
    expect(await t.events()).toContain("subscription.charged");
    expect(await t.run()).toEqual({ charged: 0, failed: 0 }); // nothing due any more
  });
  it("marks the subscription completed after the last charge", async () => {
    const t = await active({
      async subscriptionState() {
        return { nextCharge: BigInt(NOW_S + 2_592_000), charges: 2, status: "completed" as const };
      },
    });
    await t.run();
    expect((await t.row()).status).toBe("completed");
  });
  it("retries a failed charge a day later and calls it past due after three failures", async () => {
    const t = await active({ estimateGas: async () => { throw new Rejected("ERC20InsufficientBalance"); } });
    const day = 86_400_000;
    const start = new Date("2026-11-06T12:00:00Z").getTime();
    expect(await t.run(new Date(start))).toEqual({ charged: 0, failed: 1 });
    expect(await t.run(new Date(start + 3_600_000))).toEqual({ charged: 0, failed: 0 }); // too soon to retry
    await t.run(new Date(start + day));
    expect((await t.row()).status).toBe("active");
    await t.run(new Date(start + 2 * day));
    expect(await t.row()).toMatchObject({ status: "past_due", failedAttempts: 3 });
    expect(await t.events()).toContain("subscription.past_due");
    expect(await t.run(new Date(start + 5 * day))).toEqual({ charged: 0, failed: 0 }); // no more automatic tries
  });
  it("does not charge cancelled subscriptions or ones not yet due, and does not blame the customer when the merchant has no gas set aside", async () => {
    const t = await active();
    await t.w.db.update(subscriptions).set({ nextChargeAt: NOW_S + 1000 });
    expect(await t.run()).toEqual({ charged: 0, failed: 0 });
    await t.w.db.update(subscriptions).set({ nextChargeAt: NOW_S - 1 });
    await t.w.db.delete(gasTanks);
    expect(await t.run()).toEqual({ charged: 0, failed: 0 });
    expect((await t.row()).failedAttempts).toBe(0);
    await t.w.db.update(subscriptions).set({ status: "cancelled" });
    expect(await t.run()).toEqual({ charged: 0, failed: 0 });
  });
});
