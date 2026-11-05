import { eq } from "drizzle-orm";
import { fromUnits } from "@stenmont/shared";
import type { Db } from "./app";
import type { ChainClient, RouterLog } from "./chain";
import { chainCursor, invoices, payments } from "./db/schema";
import type { Env } from "./env";
import { invoiceView } from "./lib/views";
import { emitEvent } from "./webhooks";

const CURSOR = "router";
const MAX_WINDOW = 2000n;

export type IndexerResult =
  | { status: "ok"; from: bigint; to: bigint; logs: number }
  | { status: "idle" }
  | { status: "error"; error: string };

/**
 * Reads PaymentRouter events in windows of at most 2000 blocks, a few confirmations behind the head, and applies them.
 * Safe to re-run over the same blocks: payments are unique per (tx, log index), webhook deliveries are unique per
 * event, and invoice totals only ever move forward. The cursor only advances after a window is fully applied.
 */
export async function runIndexer(env: Env, db: Db, chain: ChainClient): Promise<IndexerResult> {
  try {
    const [cur] = await db.select().from(chainCursor).where(eq(chainCursor.name, CURSOR));
    const last = BigInt(cur?.lastBlock ?? Number(env.ROUTER_DEPLOY_BLOCK) - 1);
    const head = await chain.getBlockNumber();
    const safe = head - BigInt(env.INDEXER_CONFIRMATIONS ?? "2");
    const from = last + 1n;
    if (from > safe) return { status: "idle" };
    const to = safe < from + MAX_WINDOW - 1n ? safe : from + MAX_WINDOW - 1n;

    const logs = (await chain.getRouterLogs(from, to)).sort(
      (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
    );
    for (const log of logs) await apply(env, db, log);

    await db
      .insert(chainCursor)
      .values({ name: CURSOR, lastBlock: Number(to) })
      .onConflictDoUpdate({ target: chainCursor.name, set: { lastBlock: Number(to) } });
    return { status: "ok", from, to, logs: logs.length };
  } catch (e) {
    console.error("indexer failed", e);
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

const eventId = (l: RouterLog) => `evt_${l.transactionHash}_${l.logIndex}`;

async function apply(env: Env, db: Db, log: RouterLog): Promise<void> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, log.args.id));
  if (!inv) return; // not one of ours
  const now = new Date().toISOString();

  if (log.eventName === "InvoicePaid") {
    await db
      .insert(payments)
      .values({
        id: crypto.randomUUID(),
        invoiceId: inv.id,
        payer: log.args.payer,
        value: log.args.value.toString(),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        createdAt: now,
      })
      .onConflictDoNothing();
    if (log.args.paidTotal > BigInt(inv.amountPaid)) {
      const status = log.args.fullyPaid ? "paid" : inv.status === "cancelled" ? "cancelled" : "partially_paid";
      await db.update(invoices).set({ amountPaid: log.args.paidTotal.toString(), status, updatedAt: now }).where(eq(invoices.id, inv.id));
    }
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
      id: eventId(log),
      type: log.args.fullyPaid ? "invoice.paid" : "invoice.partially_paid",
      data: {
        invoice: invoiceView(fresh!, env),
        payment: { payer: log.args.payer, value: fromUnits(log.args.value), txHash: log.transactionHash, blockNumber: Number(log.blockNumber) },
      },
    });
    return;
  }

  if (log.eventName === "InvoiceRefunded") {
    if (log.args.refundedTotal > BigInt(inv.amountRefunded)) {
      await db.update(invoices).set({ amountRefunded: log.args.refundedTotal.toString(), updatedAt: now }).where(eq(invoices.id, inv.id));
    }
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
      id: eventId(log),
      type: "refund.created",
      data: {
        invoice: invoiceView(fresh!, env),
        refund: { to: log.args.to, value: fromUnits(log.args.value), txHash: log.transactionHash },
      },
    });
    return;
  }

  // InvoiceCancelled: only an unpaid invoice becomes cancelled; a paid one stays paid
  if (inv.status === "open" || inv.status === "partially_paid") {
    await db.update(invoices).set({ status: "cancelled", updatedAt: now }).where(eq(invoices.id, inv.id));
  }
  const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
  await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
    id: eventId(log),
    type: "invoice.cancelled",
    data: { invoice: invoiceView(fresh!, env) },
  });
}
