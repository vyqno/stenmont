import { and, eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { invoices, merchants, paymentLinks } from "../db/schema";
import { fail } from "../errors";
import { idSchema } from "../lib/validation";
import { isPaused } from "../sites/switch";
import { publicTrust } from "../verification/publicTrust";

export const publicRoutes = new Hono<AppEnv>();

/** What the customer's pay page needs. No auth, so nothing private: no email, metadata or internal ids. */
publicRoutes.get("/pay/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return fail(c, 404, "not_found", "Invoice not found");
  const [row] = await c.var.db
    .select({ inv: invoices, merchantName: merchants.name })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(and(eq(invoices.id, id), notInArray(invoices.status, ["creating", "failed"])));
  if (!row) return fail(c, 404, "not_found", "Invoice not found");
  const amount = BigInt(row.inv.amount);
  const paid = BigInt(row.inv.amountPaid);
  const open = row.inv.status === "open" || row.inv.status === "partially_paid";
  return c.json({
    id: row.inv.id,
    number: row.inv.number,
    status: row.inv.status,
    amount: fromUnits(amount),
    amountPaid: fromUnits(paid),
    remaining: open ? fromUnits(amount - paid) : "0",
    currency: row.inv.currency,
    dueDate: row.inv.dueDate,
    merchantName: row.merchantName,
    payeeName: row.inv.payeeName,
    successUrl: row.inv.successUrl,
    cancelUrl: row.inv.cancelUrl,
    paused: await isPaused(c.var.db, row.inv.merchantId),
    trust: await publicTrust(c.var.db, row.inv.merchantId, c.var.now()),
  });
});

publicRoutes.get("/l/:slug", async (c) => {
  const [row] = await c.var.db
    .select({ link: paymentLinks, merchantName: merchants.name })
    .from(paymentLinks)
    .innerJoin(merchants, eq(merchants.id, paymentLinks.merchantId))
    .where(and(eq(paymentLinks.slug, c.req.param("slug")), eq(paymentLinks.active, 1)));
  if (!row) return fail(c, 404, "not_found", "Link not found");
  return c.json({
    slug: row.link.slug,
    amount: row.link.amount ? fromUnits(BigInt(row.link.amount)) : null,
    reusable: row.link.reusable === 1,
    merchantName: row.merchantName,
  });
});
