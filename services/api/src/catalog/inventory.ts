import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../app";
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
 * an unpaid one past its hold goes back on the shelf. Each order changes state once (a conditional update), so stock is returned once.
 * ponytail: runs when someone looks (checkout, order list), not on a timer. Add a cron call if holds must free up with nobody watching.
 */
export async function settleOrders(db: Db, merchantId: string, now: Date) {
  const open = await db
    .select({ o: storeOrders, invoiceStatus: invoices.status })
    .from(storeOrders)
    .leftJoin(invoices, and(eq(invoices.id, storeOrders.invoiceId), eq(invoices.merchantId, merchantId)))
    .where(and(eq(storeOrders.merchantId, merchantId), eq(storeOrders.status, "reserved")))
    .limit(200);
  for (const { o, invoiceStatus } of open) {
    if (invoiceStatus === "paid") {
      await db.update(storeOrders).set({ status: "paid", updatedAt: now.toISOString() }).where(and(eq(storeOrders.id, o.id), eq(storeOrders.status, "reserved")));
    } else if (o.reservedUntil < now.toISOString()) {
      const won = await db
        .update(storeOrders)
        .set({ status: "released", updatedAt: now.toISOString() })
        .where(and(eq(storeOrders.id, o.id), eq(storeOrders.status, "reserved")))
        .returning({ id: storeOrders.id });
      if (won.length) await restock(db, merchantId, JSON.parse(o.lines) as OrderLine[]);
    }
  }
}
