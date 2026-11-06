import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../app";
import {versionChain} from "../protocol";
import type { ChainClient } from "../chain";
import { zeroAddress, type Hex } from "viem";
import { invoices, storeOrders, variants } from "../db/schema";

export type OrderLine = { variantId: string; title: string; quantity: number; unitPrice: string; tracked: boolean };
export const RESERVE_MINUTES = 30;

/**
 * Takes stock with one conditional UPDATE per variant ("inventory >= quantity"), which SQLite applies atomically, so two buyers
 * can never both get the last unit. If a later line fails, the lines already taken are put back.
 */
export async function reserveStock(db: Db, merchantId: string, lines: OrderLine[]): Promise<{ ok: true } | { ok: false; variantId: string }> {
  const taken: OrderLine[] = [];
  for (const l of lines.filter((l) => l.tracked)) {
    const hit = await db
      .update(variants)
      .set({ inventory: sql`${variants.inventory} - ${l.quantity}` })
      .where(and(eq(variants.id, l.variantId), eq(variants.merchantId, merchantId), eq(variants.trackInventory, 1), gte(variants.inventory, l.quantity)))
      .returning({ id: variants.id });
    if (hit.length === 0) {
      await restock(db, merchantId, taken);
      return { ok: false, variantId: l.variantId };
    }
    taken.push(l);
  }
  return { ok: true };
}

export async function restock(db: Db, merchantId: string, lines: OrderLine[]) {
  for (const l of lines.filter((l) => l.tracked)) {
    await db.update(variants).set({ inventory: sql`${variants.inventory} + ${l.quantity}` }).where(and(eq(variants.id, l.variantId), eq(variants.merchantId, merchantId)));
  }
}

/**
 * Brings this business's open reservations up to date: an order whose invoice is paid becomes `paid` and keeps its stock taken;
 * an unpaid one is released only after its invoice is authoritatively cancelled with no payment or hook. Hosted expiry alone never proves that it cannot still be paid. Each order changes state once, so stock is returned once.
 * ponytail: runs when someone looks (checkout, order list), not on a timer. Add a cron call if holds must free up with nobody watching.
 */
export async function settleOrders(db: Db, merchantId: string, now: Date, chain: Pick<ChainClient, "invoiceState"|"forVersion"|"forRouter">) {
  const open = await db
    .select({ o: storeOrders, invoiceStatus: invoices.status, invoicePaid: invoices.amountPaid,contractVersion:invoices.contractVersion,routerAddress:invoices.routerAddress })
    .from(storeOrders)
    .leftJoin(invoices, and(eq(invoices.id, storeOrders.invoiceId), eq(invoices.merchantId, merchantId)))
    .where(and(eq(storeOrders.merchantId, merchantId), eq(storeOrders.status, "reserved")))
    .limit(200);
  for (const { o, invoiceStatus, invoicePaid,contractVersion,routerAddress } of open) {
    if (invoiceStatus === "paid") {
      await db.update(storeOrders).set({ status: "paid", updatedAt: now.toISOString() }).where(and(eq(storeOrders.id, o.id), eq(storeOrders.status, "reserved")));
    } else if (o.reservedUntil < now.toISOString() && o.invoiceId && invoiceStatus === "cancelled" && invoicePaid === "0") {
      // An expiry timestamp or DB failure flag cannot invalidate a signed onchain invoice. A confirmed
      // cancellation is irreversible; paid/hooked/unknown states retain stock for operator reconciliation.
      let state;
      try { state = await (contractVersion==='v2'?versionChain(chain as ChainClient,'v2'):routerAddress&&chain.forRouter?chain.forRouter(routerAddress as `0x${string}`):chain).invoiceState(o.invoiceId as Hex); } catch { continue; }
      if (state.status !== 3 || state.paid !== 0n || state.hook.toLowerCase() !== zeroAddress) continue;
      const won = await db
        .update(storeOrders)
        .set({ status: "released", updatedAt: now.toISOString() })
        .where(and(eq(storeOrders.id, o.id), eq(storeOrders.status, "reserved"),
          sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${o.invoiceId} AND merchant_id = ${merchantId} AND status = 'cancelled' AND amount_paid = '0')`,
          sql`NOT EXISTS (SELECT 1 FROM payments WHERE invoice_id = ${o.invoiceId})`,
          sql`NOT EXISTS (SELECT 1 FROM relayer_txs WHERE invoice_id = ${o.invoiceId} AND kind IN ('pay','deploy_pay') AND status IN ('pending','sent','success'))`))
        .returning({ id: storeOrders.id });
      if (won.length) await restock(db, merchantId, JSON.parse(o.lines) as OrderLine[]);
    }
  }
}
