import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceId } from "@stenmont/shared";
import type { RouterLog } from "../src/chain";
import { invoices, payments, refunds, webhookDeliveries, chainCursor } from "../src/db/schema";
import { runIndexer } from "../src/indexer";
import { baseEnv, MERCHANT_ADDRESS, seedMerchant } from "./helpers/app";
import { newD1 } from "./helpers/d1";
import { fakeChain } from "./helpers/chain";
import { dbOf, fakeQueue, seedEndpoint, seedInvoice } from "./helpers/fixtures";

const PAYER = "0x2222222222222222222222222222222222222222" as const;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const paid = (id: `0x${string}`, value: bigint, total: bigint, full: boolean, block = 200n, logIndex = 0, tx = 1): RouterLog => ({
  eventName: "InvoicePaid",
  args: { id, payer: PAYER, value, paidTotal: total, fullyPaid: full },
  transactionHash: H(tx),
  logIndex,
  blockNumber: block,
});

async function setup(logs: RouterLog[], latest = 1_000n) {
  const d1 = newD1();
  await seedMerchant(d1);
  const id = (await seedInvoice(d1)) as `0x${string}`;
  await seedEndpoint(d1);
  const q = fakeQueue();
  const calls: [bigint, bigint][] = [];
  const chain = fakeChain({
    async getBlockNumber() {
      return latest;
    },
    async getRouterLogs(from, to) {
      calls.push([from, to]);
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
    },
  });
  const env = { ...baseEnv(d1), WEBHOOKS: q } as unknown as ReturnType<typeof baseEnv>;
  const db = dbOf(d1);
  const run = () => runIndexer(env, db, chain);
  const cursor = async () => (await db.select().from(chainCursor).where(eq(chainCursor.name, "router")))[0]?.lastBlock;
  const invoice = async () => (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
  return { d1, db, id, q, chain, calls, run, cursor, invoice };
}

describe("indexer: windows and cursor", () => {
  it("starts at the deploy block, stays 2 confirmations behind the head and advances the cursor", async () => {
    const t = await setup([]);
    expect((await t.run()).status).toBe("ok");
    expect(t.calls).toEqual([[100n, 998n]]);
    expect(await t.cursor()).toBe(998);
  });
  it("never asks for more than 2000 blocks at once", async () => {
    const t = await setup([], 100_000n);
    await t.run();
    expect(t.calls).toEqual([[100n, 2099n]]);
    await t.run();
    expect(t.calls[1]).toEqual([2100n, 4099n]);
  });
  it("does nothing when there are no new safe blocks", async () => {
    const t = await setup([], 101n); // safe head = 99, below the deploy block
    expect((await t.run()).status).toBe("idle");
    expect(t.calls).toHaveLength(0);
  });
  it("keeps the cursor when the RPC fails, so nothing is skipped", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => {
      throw new Error("rpc down");
    };
    expect((await t.run()).status).toBe("error");
    expect(await t.cursor()).toBeUndefined();
  });
});

describe("indexer: InvoicePaid", () => {
  it("a partial payment records the payment, updates the invoice and queues one webhook", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [paid(t.id, 4_000_000n, 4_000_000n, false)];
    await t.run();
    expect(await t.invoice()).toMatchObject({ status: "partially_paid", amountPaid: "4000000" });
    expect(await t.db.select().from(payments)).toHaveLength(1);
    const d = await t.db.select().from(webhookDeliveries);
    expect(d).toHaveLength(1);
    expect(d[0]!.type).toBe("invoice.partially_paid");
    expect(d[0]!.eventId).toBe(`evt_${H(1)}_0`);
    expect(JSON.parse(d[0]!.payload).data.payment).toMatchObject({ payer: PAYER, value: "4", txHash: H(1) });
    expect(t.q.sent).toHaveLength(1);
  });
  it("the final payment marks the invoice paid and emits invoice.paid", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [
      paid(t.id, 4_000_000n, 4_000_000n, false, 200n, 0, 1),
      paid(t.id, 6_000_000n, 10_000_000n, true, 201n, 3, 2),
    ];
    await t.run();
    expect(await t.invoice()).toMatchObject({ status: "paid", amountPaid: "10000000" });
    expect((await t.db.select().from(webhookDeliveries)).map((d) => d.type).sort()).toEqual(["invoice.paid", "invoice.partially_paid"]);
  });
  it("processing the same logs twice changes nothing and sends nothing again", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [paid(t.id, 10_000_000n, 10_000_000n, true)];
    await t.run();
    await t.d1.prepare("delete from chain_cursor").run(); // force a re-scan
    await t.run();
    expect(await t.db.select().from(payments)).toHaveLength(1);
    expect(await t.db.select().from(webhookDeliveries)).toHaveLength(1);
    expect(t.q.sent).toHaveLength(1);
    expect(await t.invoice()).toMatchObject({ status: "paid", amountPaid: "10000000" });
  });
  it("an older event replayed later never moves the invoice backwards", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [paid(t.id, 10_000_000n, 10_000_000n, true, 300n, 0, 9)];
    await t.run();
    await t.d1.prepare("delete from chain_cursor").run();
    t.chain.getRouterLogs = async () => [paid(t.id, 4_000_000n, 4_000_000n, false, 200n, 0, 1)];
    await t.run();
    expect(await t.invoice()).toMatchObject({ status: "paid", amountPaid: "10000000" });
  });
  it("ignores events for invoices we do not know, and still advances the cursor", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [paid(invoiceId(MERCHANT_ADDRESS, "SOMEONE-ELSES"), 1n, 1n, false)];
    expect((await t.run()).status).toBe("ok");
    expect(await t.db.select().from(payments)).toHaveLength(0);
    expect(await t.cursor()).toBe(998);
  });
});

describe("indexer: refunds and cancellation", () => {
  it("InvoiceRefunded records the refunded amount and emits refund.created", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [
      { eventName: "InvoiceRefunded", args: { id: t.id, to: PAYER, value: 3_000_000n, refundedTotal: 3_000_000n }, transactionHash: H(5), logIndex: 1, blockNumber: 300n },
    ];
    await t.run();
    expect(await t.invoice()).toMatchObject({ amountRefunded: "3000000" });
    expect((await t.db.select().from(webhookDeliveries))[0]!.type).toBe("refund.created");
  });
  it("InvoiceCancelled cancels an open invoice but never un-pays a paid one", async () => {
    const t = await setup([]);
    t.chain.getRouterLogs = async () => [{ eventName: "InvoiceCancelled", args: { id: t.id }, transactionHash: H(6), logIndex: 0, blockNumber: 300n }];
    await t.run();
    expect((await t.invoice()).status).toBe("cancelled");

    const u = await setup([]);
    u.chain.getRouterLogs = async () => [
      paid(u.id, 10_000_000n, 10_000_000n, true, 200n, 0, 1),
      { eventName: "InvoiceCancelled", args: { id: u.id }, transactionHash: H(6), logIndex: 0, blockNumber: 300n },
    ];
    await u.run();
    expect((await u.invoice()).status).toBe("paid");
  });
});

describe("indexer: refund ledger", () => {
  it("records each refund once, even when the same block is read again", async () => {
    const refund = (id: `0x${string}`): RouterLog => ({
      eventName: "InvoiceRefunded",
      args: { id, to: PAYER, value: 2_000_000n, refundedTotal: 2_000_000n },
      transactionHash: H(9),
      logIndex: 1,
      blockNumber: 300n,
    });
    const d1 = newD1();
    await seedMerchant(d1);
    const id = (await seedInvoice(d1)) as `0x${string}`;
    const chain = fakeChain({ getBlockNumber: async () => 1_000n, getRouterLogs: async (from, to) => [refund(id)].filter((l) => l.blockNumber >= from && l.blockNumber <= to) });
    const env = { ...baseEnv(d1), WEBHOOKS: fakeQueue() } as unknown as ReturnType<typeof baseEnv>;
    const db = dbOf(d1);
    await runIndexer(env, db, chain);
    await db.delete(chainCursor); // read the same blocks again
    await runIndexer(env, db, chain);
    const rows = await db.select().from(refunds);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ invoiceId: id, toAddress: PAYER, value: "2000000", txHash: H(9), logIndex: 1, blockNumber: 300 });
  });
});
