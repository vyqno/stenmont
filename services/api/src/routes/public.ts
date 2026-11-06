import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { invoices, merchants, paymentLinks, subscriptions } from "../db/schema";
import { fail } from "../errors";
import { idSchema } from "../lib/validation";
import { isPaused } from "../sites/switch";
import { invoiceProtocol,versionChain } from "../protocol";
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
    .where(and(eq(invoices.id, id), notInArray(invoices.status, ["creating", "failed", "expired"])));
  if (!row) return fail(c, 404, "not_found", "Invoice not found");
  const protocol=invoiceProtocol(c.env,row.inv);
  let details=null;
  if(protocol.version==='v2'){
    const chain=versionChain(c.var.chain,protocol.version,protocol.router,c.env.ROUTER_ADDRESS);
    if(!chain.invoiceDetails)return fail(c,503,'chain_unavailable','Invoice contract read unavailable.');
    details=await chain.invoiceDetails(row.inv.id as `0x${string}`);
    if(row.inv.payout&&details.payout.toLowerCase()!==row.inv.payout.toLowerCase())return fail(c,503,'provenance_mismatch','Invoice payout differs from recorded provenance.');
  }
  if(details&&details.status===0)return fail(c,503,'chain_unavailable','The configured router has no matching invoice.');
  const amount = details?.amount??BigInt(row.inv.amount);
  const paid = details?.paid??BigInt(row.inv.amountPaid);
  const status=details?(details.status===2?'paid':details.status===3?'cancelled':paid>0n?'partially_paid':'open'):row.inv.status;
  const open = status === "open" || status === "partially_paid";
  const discountAvailable=!!details&&open&&paid===0n&&details.discountBps>0&&details.hook.toLowerCase()==='0x0000000000000000000000000000000000000000'&&BigInt(Math.floor(c.var.now().getTime()/1000))<=details.discountUntil;
  const settlementAmount=open?(discountAvailable?amount-amount*BigInt(details!.discountBps)/10000n:amount-paid):0n;
  // A business-to-business invoice may be offered in parts: the pay page links to the plan while it can still be taken up.
  const [plan] =
    row.inv.status === "open"
      ? await c.var.db
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.invoiceId, row.inv.id), eq(subscriptions.kind, "instalment"), inArray(subscriptions.status, ["offered", "subscribing"])))
          .orderBy(desc(subscriptions.createdAt))
          .limit(1)
      : [];
  return c.json({
    instalments: plan ? { count: plan.maxCharges, each: fromUnits(BigInt(plan.amount)), url: `${c.env.APP_URL}/subscribe/${plan.id}` } : null,
    id: row.inv.id,
    contractVersion:protocol.version,routerAddress:protocol.router,claimAddress:protocol.retired?null:protocol.claim,
    payout:details?.payout??row.inv.payout,payerLock:details?.payerLock??row.inv.payerLock,
    minPayment:fromUnits(details?.minPayment??BigInt(row.inv.minPayment)),discountBps:details?.discountBps??row.inv.discountBps,
    discountUntil:details?Number(details.discountUntil):row.inv.discountUntil,hook:details?.hook??row.inv.hook,
    number: row.inv.number,
    status,
    amount: fromUnits(amount),
    amountPaid: fromUnits(paid),
    remaining: open ? fromUnits(amount - paid) : "0",
    settlementAmount:fromUnits(settlementAmount),discountAvailable,
    currency: row.inv.currency,
    dueDate:details?(details.dueDate===0n?null:new Date(Number(details.dueDate)*1000).toISOString()):row.inv.dueDate,
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
