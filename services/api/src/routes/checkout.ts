import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { RESERVE_MINUTES, reserveStock, restock, settleOrders, type OrderLine } from "../catalog/inventory";
import { MAX_ORDER_UNITS } from "../catalog/schemas";
import { products, storeOrders, variants } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent, type IdempotentResult } from "../idempotency";
import { randomHex } from "../lib/crypto";
import { invalid } from "../lib/validation";
import { createInvoice } from "./invoices";

export const cartSchema = z.strictObject({
  items: z.array(z.strictObject({ variantId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(1000) })).min(1).max(50),
  customerEmail: z.email().max(254).optional(),
  successUrl: z.string().max(2048).optional(),
  cancelUrl: z.string().max(2048).optional(),
});

export const checkoutRoutes = new Hono<AppEnv>();

/**
 * Cart in, invoice out. The cart carries only variant ids and quantities: prices come from our database, stock is taken
 * atomically, and the invoice is made by the same code as POST /v1/invoices. Used by the merchant route below and by the
 * public shopper route; the caller has already put the business on the context (`c.var.merchant`).
 */
export async function placeOrder(c: Context<AppEnv>, input: z.infer<typeof cartSchema>): Promise<IdempotentResult | Response> {
  const { db, merchant } = c.var;
  {
    const now = c.var.now();
    await settleOrders(db, merchant.id, now);

    const qty = new Map<string, number>();
    for (const i of input.items) qty.set(i.variantId, (qty.get(i.variantId) ?? 0) + i.quantity);
    const rows = await db
      .select({ v: variants, title: products.title })
      .from(variants)
      .innerJoin(products, and(eq(products.id, variants.productId), eq(products.merchantId, merchant.id)))
      .where(and(eq(variants.merchantId, merchant.id), eq(products.status, "active"), inArray(variants.id, [...qty.keys()])));
    const byId = new Map(rows.map((r) => [r.v.id, r]));
    const lines: OrderLine[] = [];
    let total = 0n;
    for (const [variantId, quantity] of qty) {
      const r = byId.get(variantId);
      if (!r) return fail(c, 422, "variant_unavailable", "An item in the cart is not for sale", { variantId });
      if (quantity > 1000) return fail(c, 400, "invalid_request", "Quantity too large");
      const unit = BigInt(r.v.price);
      total += unit * BigInt(quantity);
      const name = [r.title, r.v.title].filter((x) => x && x !== "Default Title").join(" - ");
      lines.push({ variantId, title: name, quantity, unitPrice: fromUnits(unit), tracked: r.v.trackInventory === 1 });
    }
    if (total <= 0n || total > MAX_ORDER_UNITS) return fail(c, 400, "order_too_large", "The order total is outside the allowed range");

    const stock = await reserveStock(db, merchant.id, lines);
    if (!stock.ok) return fail(c, 409, "out_of_stock", "Not enough stock for an item in the cart", { variantId: stock.variantId });

    const orderId = `ord_${randomHex(10)}`;
    await db.insert(storeOrders).values({
      id: orderId,
      merchantId: merchant.id,
      status: "reserved",
      lines: JSON.stringify(lines),
      total: total.toString(),
      reservedUntil: new Date(now.getTime() + RESERVE_MINUTES * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const fallBack = async () => {
      await db.update(storeOrders).set({ status: "failed", updatedAt: now.toISOString() }).where(eq(storeOrders.id, orderId));
      await restock(db, merchant.id, lines);
    };
    let made;
    try {
      made = await createInvoice(c, {
        amount: fromUnits(total),
        number: `ORD-${orderId.slice(4).toUpperCase()}`,
        ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
        ...(input.successUrl ? { successUrl: input.successUrl } : {}),
        ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
        metadata: { order: orderId, source: "stenmont-store" },
      });
    } catch (e) {
      await fallBack();
      throw e;
    }
    if (made instanceof Response) {
      await fallBack();
      return made;
    }
    const invoice = made.body as { id: string };
    await db.update(storeOrders).set({ invoiceId: invoice.id }).where(eq(storeOrders.id, orderId));
    await audit(db, { merchantId: merchant.id, actor: `merchant:${merchant.id}`, action: "store.checkout", payload: { orderId, invoiceId: invoice.id, total: fromUnits(total) } });
    return {
      status: 201 as const,
      body: { orderId, status: "reserved", total: fromUnits(total), lines: lines.map(({ tracked: _t, ...l }) => l), invoice: made.body },
    };
  }
}

checkoutRoutes.post("/checkout", async (c) => {
  const parsed = cartSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  return runIdempotent(c, c.var.merchant.id, () => placeOrder(c, parsed.data));
});

checkoutRoutes.get("/orders", async (c) => {
  await settleOrders(c.var.db, c.var.merchantId, c.var.now());
  const rows = await c.var.db.select().from(storeOrders).where(eq(storeOrders.merchantId, c.var.merchantId)).orderBy(desc(storeOrders.createdAt)).limit(100);
  return c.json({
    data: rows.map((o) => ({ id: o.id, status: o.status, total: fromUnits(BigInt(o.total)), invoiceId: o.invoiceId, lines: JSON.parse(o.lines).map(({ tracked: _t, ...l }: OrderLine) => l), createdAt: o.createdAt })),
  });
});
