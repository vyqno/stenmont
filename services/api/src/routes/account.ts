import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deployments, fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { signAccountToken, verifyAccountToken } from "../account/token";
import type { Env } from "../env";
import { invoices, merchants, payments, refunds, subscriptions } from "../db/schema";
import { fail } from "../errors";

const PURPOSE = "receipts";

/** The receipts link handed to a payer right after they pay. Undefined when links are not configured (the page then just shows no link). */
export async function issueAccountToken(env: Pick<Env, "ACCOUNT_LINK_SECRET">, payer: string, now: Date): Promise<string | undefined> {
  return env.ACCOUNT_LINK_SECRET ? signAccountToken(env.ACCOUNT_LINK_SECRET, payer, PURPOSE, now) : undefined;
}

export const accountRoutes = new Hono<AppEnv>();

const receipt = (tx: string) => `${deployments.explorer}/tx/${tx}`;

/**
 * A payer's own history, read with a signed link (Authorization: Bearer). Every query is filtered on the payer the link names, and
 * the answer carries no ids of ours: only what the person already knows (the shop, the invoice number, amounts) and the receipt.
 */
accountRoutes.get("/summary", async (c) => {
  const secret = c.env.ACCOUNT_LINK_SECRET;
  if (!secret) return fail(c, 503, "account_unavailable", "Receipts are not available right now.");
  c.header("cache-control", "no-store");
  const token = (c.req.header("authorization") ?? "").replace(/^Bearer /i, "");
  const payer = await verifyAccountToken(secret, token, PURPOSE, c.var.now());
  if (!payer) return fail(c, 401, "invalid_link", "This link is not valid or has expired.");

  const { db } = c.var;
  const paid = await db
    .select({ p: payments, number: invoices.number, shop: merchants.name })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(sql`lower(${payments.payer}) = ${payer}`)
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(100);
  const back = await db
    .select({ r: refunds, number: invoices.number, shop: merchants.name })
    .from(refunds)
    .innerJoin(invoices, eq(invoices.id, refunds.invoiceId))
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(sql`lower(${refunds.toAddress}) = ${payer}`)
    .orderBy(desc(refunds.createdAt), desc(refunds.id))
    .limit(100);
  const subs = await db
    .select({ s: subscriptions, shop: merchants.name })
    .from(subscriptions)
    .innerJoin(merchants, eq(merchants.id, subscriptions.merchantId))
    .where(sql`lower(${subscriptions.payer}) = ${payer}`)
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(100);

  return c.json({
    payer,
    payments: paid.map((x) => ({ invoiceNumber: x.number, merchantName: x.shop, amount: fromUnits(BigInt(x.p.value)), at: x.p.createdAt, receiptUrl: receipt(x.p.txHash) })),
    refunds: back.map((x) => ({ invoiceNumber: x.number, merchantName: x.shop, amount: fromUnits(BigInt(x.r.value)), at: x.r.createdAt, receiptUrl: receipt(x.r.txHash) })),
    subscriptions: subs.map((x) => ({
      id: x.s.id,
      merchantName: x.shop,
      amount: fromUnits(BigInt(x.s.amount)),
      periodSeconds: x.s.periodSeconds,
      maxCharges: x.s.maxCharges,
      charges: x.s.charges,
      status: x.s.status,
      nextChargeAt: x.s.status === "active" || x.s.status === "past_due" ? new Date(x.s.nextChargeAt * 1000).toISOString() : null,
      manager: c.env.SUBSCRIPTION_MANAGER_ADDRESS,
    })),
  });
});
