import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { decodeFunctionData } from "viem";
import { multicall3Abi, subscriptionManagerAbi } from "@stenmont/shared";
import { runRenewals } from "../src/renewals";
import { setup, seedMerchant } from "./helpers/app";
import { dbOf } from "./helpers/fixtures";
import { gasTanks, subscriptions } from "../src/db/schema";
import { createInstalmentPlan, readAgreementState, splitInstalments } from "../src/instalments";

// These tests catch overcharging by ceil division, dropped remainders, and unsigned second agreements.
describe("bounded remainder-first agreements", () => {
  it("allocates the remainder to the first of at most three charges", () => {
    expect(splitInstalments(100_000_000n, 3)).toMatchObject({ each: 33_333_333n, first: 33_333_334n });
    expect(splitInstalments(100_000_001n, 3)).toMatchObject({ each: 33_333_333n, first: 33_333_335n });
    expect(() => splitInstalments(100n, 4)).toThrow();
  });
  it("uses two exact fixed-amount agreements with aggregate cap three and total exactly the invoice", async () => {
    const t = setup({ invoiceState: async () => ({ status: 3, paid: 0n, hook: "0x0000000000000000000000000000000000000000" }) }); const key = await seedMerchant(t.db);
    const r = await t.req("/v1/invoices", { key, idem: "parts", method: "POST", body: JSON.stringify({ amount: "100", instalments: 3, b2b: true, payerBusinessName: "Globex Ltd" }) });
    const body = await r.json() as any;
    const data = await (await t.req(`/pay/subscription/${body.instalmentPlan.id}`)).json() as any;
    expect(data.segments.map((s: any) => [s.amount, s.maxCharges])).toEqual([["33.333334", 1], ["33.333333", 2]]);
    expect(data.segments[1].startAt - data.segments[0].startAt).toBe(2592000);
    expect(data.segments.reduce((sum: number, s: any) => sum + s.maxCharges, 0)).toBe(3);
    const db = dbOf(t.db);
    await db.insert(gasTanks).values({ merchantId: "m_1", wbtBalance: "100000000000000000", dailyCapWbt: "100000000000000000", spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
    const payload = { id: data.id, payer: "0x2222222222222222222222222222222222222222", deadline: "1793960000", payerSig: "0x1234", permitValue: "100000000", permitDeadline: "1793960000", permitSig: "0x1234" };
    expect((await t.req("/relay/subscribe", { method: "POST", body: JSON.stringify(payload) })).status).toBe(400);
    expect(t.chain.sent).toHaveLength(0);
    const sent = await t.req("/relay/subscribe", { method: "POST", body: JSON.stringify({ ...payload, segmentSignatures: ["0x1234", "0x5678"] }) });
    expect(sent.status).toBe(200);
    const outer = decodeFunctionData({ abi: multicall3Abi, data: t.chain.sent[0]!.data });
    const calls = outer.args![0] as readonly { callData: `0x${string}` }[];
    const decoded = calls.map(c => decodeFunctionData({ abi: subscriptionManagerAbi, data: c.callData }));
    expect(decoded.map(c => c.functionName)).toEqual(["subscribe", "subscribe", "charge"]);
    const terms = decoded.slice(0, 2).map(c => c.args![1] as { amount: bigint; maxCharges: number });
    expect(terms.reduce((n, s) => n + s.amount * BigInt(s.maxCharges), 0n)).toBe(100_000_000n);
    expect(terms.reduce((n, s) => n + s.maxCharges, 0)).toBe(3);
    const receipts = await t.db.prepare("select amount,tx_hash from instalment_charges").all();
    expect(receipts.results).toHaveLength(1);
    expect(receipts.results[0]).toMatchObject({ amount: "33333334", tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
  });
  it("guards direct helper callers against consumer plans and a fourth charge", async () => {
    const t = setup(); await seedMerchant(t.db);
    const db = dbOf(t.db);
    await expect(createInstalmentPlan(db, t.clock.now, { invoice: { amount: "100", amountPaid: "0" } as any, count: 4, periodSeconds: 60, payerBusinessName: "Globex" })).rejects.toThrow();
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
});


describe("paired cancellation and aggregate state", () => {
  async function active() {
    const t = setup({ invoiceState: async () => ({ status: 3, paid: 0n, hook: "0x0000000000000000000000000000000000000000" }) }); const key = await seedMerchant(t.db); const db = dbOf(t.db);
    const inv = await (await t.req("/v1/invoices", { key, idem: "parts", method: "POST", body: JSON.stringify({ amount: "100", instalments: 3, b2b: true, payerBusinessName: "Globex" }) })).json() as any;
    const [row] = await db.select().from(subscriptions);
    await db.update(subscriptions).set({ payer: "0x2222222222222222222222222222222222222222", status: "active" }).where(eq(subscriptions.id, row!.id));
    await db.insert(gasTanks).values({ merchantId: "m_1", wbtBalance: "100000000000000000", dailyCapWbt: "100000000000000000", spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
    return { t, key, db, row: row!, segments: JSON.parse(row!.segments!) as { id: `0x${string}` }[] };
  }
  it("records only actual cron charge receipts and never invents a hash during resync", async () => {
    const w = await active(); const end = w.segments[1]!.id; let sent = false;
    w.t.chain.subscriptionState = async id => id !== end ? { status: "completed", charges: 1, nextCharge: 0n } : { status: "active", charges: sent ? 1 : 0, nextCharge: sent ? 1799140800n : 0n };
    const send = w.t.chain.sendTransaction;
    w.t.chain.sendTransaction = async call => { sent = true; return send(call); };
    const result = await runRenewals(w.t.env, w.db, w.t.chain, w.t.clock.now);
    expect(result).toEqual({ charged: 1, failed: 0 });
    const receipts = await w.t.db.prepare("select amount,agreement_id,tx_hash from instalment_charges").all();
    expect(receipts.results).toHaveLength(1);
    expect(receipts.results[0]).toMatchObject({ amount: "33333333", agreement_id: end, tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    w.t.chain.subscriptionState = async id => ({ status: "completed", charges: id === end ? 2 : 1, nextCharge: 0n });
    await w.db.update(subscriptions).set({ nextChargeAt: 0 }).where(eq(subscriptions.id, w.row.id));
    await runRenewals(w.t.env, w.db, w.t.chain, w.t.clock.now);
    expect((await w.t.db.prepare("select * from instalment_charges").all()).results).toHaveLength(1);
  });
  it("requires all merchant signatures and cancels both agreements atomically", async () => {
    const w = await active();
    const send = (signatures: unknown[]) => w.t.req(`/v1/subscriptions/${w.row.id}/cancel`, { key: w.key, method: "POST", body: JSON.stringify({ deadline: "1793960000", signatures }) });
    expect((await send([{ id: w.row.id, signature: "0x1234" }])).status).toBe(400);
    expect(w.t.chain.sent).toHaveLength(0);
    expect((await w.db.select().from(subscriptions))[0]!.status).toBe("active");
    expect((await send(w.segments.map(s => ({ id: s.id, signature: "0x1234" })))).status).toBe(200);
    const outer = decodeFunctionData({ abi: multicall3Abi, data: w.t.chain.sent[0]!.data });
    const calls = outer.args![0] as readonly { callData: `0x${string}` }[];
    const decoded = calls.map(c => decodeFunctionData({ abi: subscriptionManagerAbi, data: c.callData }));
    expect(decoded.map(c => [c.functionName, c.args![0]])).toEqual(w.segments.map(s => ["cancelWithMerchantSig", s.id]));
    expect((await w.db.select().from(subscriptions))[0]!.status).toBe("cancelled");
  });
  it("sums exact paid amounts and advances to the remaining agreement", async () => {
    const w = await active();
    const end = w.segments[1]!.id;
    w.t.chain.subscriptionState = async id => id === end ? { status: "active", charges: 1, nextCharge: 1799140800n } : { status: "completed", charges: 1, nextCharge: 1796548800n };
    expect(await readAgreementState(w.t.chain, w.row)).toMatchObject({ charges: 2, paid: 66_666_667n, status: "active", chargeId: end, amount: "33333333", nextCharge: 1799140800n });
    w.t.chain.subscriptionState = async id => ({ status: "completed", charges: id === end ? 2 : 1, nextCharge: 1801732800n });
    expect(await readAgreementState(w.t.chain, w.row)).toMatchObject({ charges: 3, paid: 100_000_000n, status: "completed" });
  });
  it("cancels the payer's remaining agreement when the first is already complete", async () => {
    const w = await active(); const end = w.segments[1]!.id;
    w.t.chain.subscriptionState = async id => ({ status: id === end ? "active" : "completed", charges: id === end ? 0 : 1, nextCharge: 1796548800n });
    const res = await w.t.req("/relay/subscription-cancel", { method: "POST", body: JSON.stringify({ id: w.row.id, deadline: "1793960000", payerSig: "0x1234", segmentSignatures: ["0x1234", "0x5678"] }) });
    expect(res.status).toBe(200);
    const decoded = decodeFunctionData({ abi: subscriptionManagerAbi, data: w.t.chain.sent[0]!.data });
    expect(decoded.functionName).toBe("cancelWithSig");
    expect(decoded.args![0]).toBe(end);
    expect(decoded.args![2]).toBe("0x5678");
  });
});

describe("replacement rail freezes the router before final terms", () => {
  async function offer() {
    const t = setup(); const key = await seedMerchant(t.db); const db = dbOf(t.db);
    const inv = await (await t.req("/v1/invoices", { key, idem: "quote", method: "POST", body: JSON.stringify({ amount: "100", instalments: 3, b2b: true, payerBusinessName: "Globex" }) })).json() as any;
    await db.insert(gasTanks).values({ merchantId: "m_1", wbtBalance: "100000000000000000", dailyCapWbt: "100000000000000000", spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" });
    return { t, key, db, inv, id: inv.instalmentPlan.id };
  }
  it("cannot activate while the router still accepts payments", async () => {
    const w = await offer();
    const response = await w.t.req("/relay/subscribe", { method: "POST", body: JSON.stringify({ id: w.id, payer: "0x2222222222222222222222222222222222222222", payerSig: "0x1234", segmentSignatures: ["0x1234", "0x5678"], deadline: "1793960000" }) });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe("prepare_required");
    expect(w.t.chain.sent).toHaveLength(0);
    const data = await (await w.t.req(`/pay/subscription/${w.id}`)).json() as any;
    expect(data.preparationRequired).toBe(true);
  });
  it("recomputes after a partial payment races before confirmed cancellation", async () => {
    const w = await offer(); let reads = 0;
    w.t.chain.invoiceState = async () => ++reads === 1 ? { status: 1, paid: 0n, hook: "0x0000000000000000000000000000000000000000" } : { status: 3, paid: 10_000_000n, hook: "0x0000000000000000000000000000000000000000" };
    const response = await w.t.req(`/v1/subscriptions/${w.id}/prepare`, { key: w.key, method: "POST", body: JSON.stringify({ deadline: "1793960000", signature: "0x1234" }) });
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data).toMatchObject({ total: "90", each: "30", count: 3, rail: "replacement_subscription", originalInvoiceStatus: "cancelled" });
    const [row] = await w.db.select().from(subscriptions);
    expect(row).toMatchObject({ total: "90000000", amount: "30000000", segments: null });
    const call = decodeFunctionData({ abi: (await import("@stenmont/shared")).paymentRouterAbi, data: w.t.chain.sent[0]!.data });
    expect(call.functionName).toBe("cancel");
    expect(call.args![0]).toBe(w.inv.id);
  });
  it("refuses a financed invoice without submitting a cancellation", async () => {
    const w = await offer();
    w.t.chain.invoiceState = async () => ({ status: 1, paid: 0n, hook: "0x4444444444444444444444444444444444444444" });
    const response = await w.t.req(`/v1/subscriptions/${w.id}/prepare`, { key: w.key, method: "POST", body: JSON.stringify({ deadline: "1793960000", signature: "0x1234" }) });
    expect(response.status).toBe(409);
    expect(w.t.chain.sent).toHaveLength(0);
  });
  it("refuses financing while a replacement plan is offered", async () => {
    const w = await offer();
    const response = await w.t.req("/v1/financing/listings", { key: w.key, method: "POST", body: JSON.stringify({ invoiceId: w.inv.id, discountBps: 500, reserveBps: 1000 }) });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe("instalment_invoice");
  });
});
