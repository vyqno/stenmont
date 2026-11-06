import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Rejected } from "../src/chain";
import { gasTanks, invoices, subscriptions, webhookDeliveries } from "../src/db/schema";
import { splitInstalments } from "../src/instalments";
import { runRenewals } from "../src/renewals";
import { baseEnv, seedMerchant, setup } from "./helpers/app";
import { dbOf, fakeQueue, seedEndpoint } from "./helpers/fixtures";

const PAYER = "0x2222222222222222222222222222222222222222";
const NOW_S = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const B2B = { instalments: 3, b2b: true, payerBusinessName: "Globex Ltd" };

async function world(chain: Parameters<typeof setup>[0] = {}) {
  const t = setup(chain);
  const key = await seedMerchant(t.db);
  const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const db = dbOf(t.db);
  await db.insert(gasTanks).values({ merchantId: "m_1", wbtBalance: (10n ** 17n).toString(), dailyCapWbt: (10n ** 17n).toString(), spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
  const invoice = (body: Record<string, unknown>, k = key) => t.req("/v1/invoices", { method: "POST", key: k, idem: crypto.randomUUID(), body: JSON.stringify({ amount: "100", ...body }) });
  const subscribe = (id: string) =>
    t.req("/relay/subscribe", { method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body: JSON.stringify({ id, payer: PAYER, deadline: String(NOW_S + 600), payerSig: "0x1234" }) });
  return { t, key, other, db, invoice, subscribe };
}

describe("splitInstalments", () => {
  it("divides evenly when it can, and reports the rounding it leaves", () => {
    expect(splitInstalments(99_000_000n, 3)).toEqual({ each: 33_000_000n, rounding: 0n });
    expect(splitInstalments(100_000_000n, 3)).toEqual({ each: 33_333_333n, rounding: 1n });
    expect(splitInstalments(100_000_001n, 3)).toEqual({ each: 33_333_333n, rounding: 2n });
  });
  it("never lets the plan charge more than the total", () => {
    for (const total of [1n, 2n, 3n, 7n, 10_000_000n, 123_456_789n]) {
      const { each, rounding } = splitInstalments(total, 3);
      expect(each * 3n + rounding).toBe(total);
      expect(rounding).toBeLessThan(3n);
    }
  });
  it("is zero when the total is too small to split", () => {
    expect(splitInstalments(2n, 3).each).toBe(0n);
  });
});

describe("an invoice with instalments", () => {
  it("is business-to-business only: it needs the flag and the buying business's name", async () => {
    const w = await world();
    for (const bad of [{ instalments: 3 }, { instalments: 3, b2b: true }, { instalments: 3, payerBusinessName: "Globex" }, { instalments: 3, b2b: false, payerBusinessName: "Globex" }, { b2b: true }]) {
      const res = await w.invoice(bad);
      expect(res.status).toBe(400);
    }
    expect(w.t.chain.calls).toHaveLength(0); // refused before anything was made
    for (const bad of [{ ...B2B, instalments: 4 }, { ...B2B, instalments: 1 }, { ...B2B, payerBusinessName: "x" }, { ...B2B, instalmentPeriodSeconds: 59 }]) {
      expect((await w.invoice(bad)).status).toBe(400);
    }
  });
  it("creates the invoice and an offered plan of 3 charges", async () => {
    const w = await world();
    const res = await w.invoice({ ...B2B, amount: "100" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.instalmentPlan).toMatchObject({ status: "offered", count: 3, each: "33.333333", total: "100", rounding: "0.000001", periodSeconds: 2_592_000, payerBusinessName: "Globex Ltd" });
    expect(body.instalmentPlan.subscribeUrl).toBe(`https://app.test/subscribe/${body.instalmentPlan.id}`);
    const [row] = await w.db.select().from(subscriptions);
    expect(row).toMatchObject({ kind: "instalment", invoiceId: body.id, merchantId: "m_1", maxCharges: 3, amount: "33333333", total: "100000000", periodSeconds: 2_592_000 });
    expect(row!.startAt).toBe(NOW_S); // the first charge is due as soon as the buyer agrees
  });
  it("lets the business choose the spacing, and refuses a total too small to split", async () => {
    const w = await world();
    const body = await json(await w.invoice({ ...B2B, instalmentPeriodSeconds: 60 }));
    expect(body.instalmentPlan.periodSeconds).toBe(60);
    expect((await w.invoice({ ...B2B, amount: "0.000002" })).status).toBe(422);
  });
  it("shows the plan on the public pay data, without private details", async () => {
    const w = await world();
    const inv = await json(await w.invoice(B2B));
    const pay = await json(await w.t.req(`/pay/${inv.id}`));
    expect(pay.instalments).toMatchObject({ count: 3, each: "33.333333", url: inv.instalmentPlan.subscribeUrl });
    const plan = await json(await w.t.req(`/pay/subscription/${inv.instalmentPlan.id}`));
    expect(plan).toMatchObject({ kind: "instalment", total: "100", amount: "33.333333", maxCharges: 3, payerBusinessName: "Globex Ltd" });
    const plain = await json(await w.invoice({ amount: "5" }));
    expect((await json(await w.t.req(`/pay/${plain.id}`))).instalments).toBeNull();
  });
  it("is replayed, not duplicated, with the same Idempotency-Key", async () => {
    const w = await world();
    const send = () => w.t.req("/v1/invoices", { method: "POST", key: w.key, idem: "same", body: JSON.stringify({ amount: "100", ...B2B }) });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect(await w.db.select().from(subscriptions)).toHaveLength(1);
  });
});

describe("the buyer takes up the plan", () => {
  it("agrees once through the same relayed call as a subscription, and the business hears about it", async () => {
    const w = await world();
    await seedEndpoint(w.t.db);
    const inv = await json(await w.invoice(B2B));
    const res = await w.subscribe(inv.instalmentPlan.id);
    expect(res.status).toBe(200);
    const [row] = await w.db.select().from(subscriptions);
    expect(row).toMatchObject({ status: "active", payer: PAYER });
    const types = (await w.db.select().from(webhookDeliveries)).map((d) => d.type);
    expect(types).toContain("instalment.started");
    expect(types).not.toContain("subscription.created");
  });
  it("is refused when the invoice was paid or cancelled in the meantime", async () => {
    const w = await world();
    const inv = await json(await w.invoice(B2B));
    await w.db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, inv.id));
    expect((await w.subscribe(inv.instalmentPlan.id)).status).toBe(409);
    expect(w.t.chain.sent).toHaveLength(0);
  });
});

describe("charging the plan (cron)", () => {
  async function active(chainOver: Parameters<typeof setup>[0] = {}) {
    const w = await world();
    const inv = await json(await w.invoice(B2B));
    await w.subscribe(inv.instalmentPlan.id);
    Object.assign(w.t.chain, chainOver);
    await seedEndpoint(w.t.db);
    const env = { ...baseEnv(w.t.db), WEBHOOKS: fakeQueue() } as unknown as ReturnType<typeof baseEnv>;
    const run = (now = new Date("2026-11-06T12:00:00Z")) => runRenewals(env, w.db, w.t.chain, now);
    const row = async () => (await w.db.select().from(subscriptions))[0]!;
    const events = async () => (await w.db.select().from(webhookDeliveries)).map((d) => d.type);
    return { w, inv, run, row, events };
  }
  const state = (charges: number, status: "active" | "completed" = "active") => async () => ({ nextCharge: BigInt(NOW_S + 2_592_000), charges, status });

  it("announces each charge as an instalment, with how many are left", async () => {
    const t = await active({ subscriptionState: state(1) });
    expect(await t.run()).toEqual({ charged: 1, failed: 0 });
    const ev = await t.events();
    expect(ev).toContain("instalment.charged");
    expect(ev).not.toContain("subscription.charged");
    const [d] = await t.w.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.type, "instalment.charged"));
    const payload = JSON.parse(d!.payload).data;
    expect(payload).toMatchObject({ instalment: { number: 1, of: 3, amount: "33.333333", invoiceId: t.inv.id, status: "active" } });
  });
  it("finishes after the third charge and says so once", async () => {
    const t = await active({ subscriptionState: state(3, "completed") });
    await t.run();
    expect((await t.row()).status).toBe("completed");
    const ev = await t.events();
    expect(ev).toContain("instalment.completed");
    expect(ev.filter((e) => e === "instalment.completed")).toHaveLength(1);
    expect(await t.run(new Date("2026-12-30T12:00:00Z"))).toEqual({ charged: 0, failed: 0 }); // the cap: a fourth charge is never tried
    expect(t.w.t.chain.sent).toHaveLength(2); // the agreement and the one charge
  });
  it("reports each failed try, retries a day later, and is past due after three", async () => {
    const t = await active({ estimateGas: async () => { throw new Rejected("ERC20InsufficientBalance"); } });
    const start = new Date("2026-11-06T12:00:00Z").getTime();
    const day = 86_400_000;
    await t.run(new Date(start));
    await t.run(new Date(start + day));
    expect((await t.row()).status).toBe("active");
    await t.run(new Date(start + 2 * day));
    expect(await t.row()).toMatchObject({ status: "past_due", failedAttempts: 3 });
    const rows = await t.w.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.type, "instalment.failed"));
    const data = rows.map((r) => JSON.parse(r.payload).data).sort((a, b) => a.attempt - b.attempt);
    expect(data.map((d) => [d.attempt, d.final])).toEqual([[1, false], [2, false], [3, true]]);
    expect(await t.events()).not.toContain("subscription.past_due");
  });
  it("does not blame the buyer when the business has no gas set aside", async () => {
    const t = await active();
    await t.w.db.delete(gasTanks);
    await t.run();
    expect((await t.row()).failedAttempts).toBe(0);
    expect(await t.events()).not.toContain("instalment.failed");
  });
  it("stops charging when the invoice was paid in full another way", async () => {
    const t = await active();
    await t.w.db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, t.inv.id));
    expect(await t.run()).toEqual({ charged: 0, failed: 0 });
    expect((await t.row()).status).toBe("cancelled");
    expect(t.w.t.chain.sent).toHaveLength(1); // only the agreement
  });
});

describe("cancel and tenant isolation", () => {
  it("lets the business stop a plan, and the buyer end it with their own signature", async () => {
    const w = await world();
    const inv = await json(await w.invoice(B2B));
    await w.subscribe(inv.instalmentPlan.id);
    const stop = await w.t.req(`/v1/subscriptions/${inv.instalmentPlan.id}/cancel`, { method: "POST", key: w.key });
    expect(stop.status).toBe(200);
    const buyer = await w.t.req("/relay/subscription-cancel", { method: "POST", headers: { "cf-connecting-ip": "9.9.9.9" }, body: JSON.stringify({ id: inv.instalmentPlan.id, deadline: String(NOW_S + 600), payerSig: "0x1234" }) });
    expect(buyer.status).toBe(200);
  });
  it("lists plans for the right business only, and filters by kind", async () => {
    const w = await world();
    const inv = await json(await w.invoice(B2B));
    await w.t.req("/v1/subscriptions", { method: "POST", key: w.key, idem: crypto.randomUUID(), body: JSON.stringify({ amount: "5", periodSeconds: 3600, maxCharges: 2 }) });
    const all = (await json(await w.t.req("/v1/subscriptions", { key: w.key }))).data as any[];
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === inv.instalmentPlan.id)).toMatchObject({ kind: "instalment", invoiceId: inv.id, total: "100" });
    const only = (await json(await w.t.req("/v1/subscriptions?kind=instalment", { key: w.key }))).data as any[];
    expect(only.map((s) => s.id)).toEqual([inv.instalmentPlan.id]);
    expect((await json(await w.t.req("/v1/subscriptions", { key: w.other }))).data).toEqual([]);
    expect((await w.t.req(`/v1/subscriptions/${inv.instalmentPlan.id}`, { key: w.other })).status).toBe(404);
    expect((await w.t.req(`/v1/subscriptions/${inv.instalmentPlan.id}/cancel`, { method: "POST", key: w.other })).status).toBe(404);
  });
});
