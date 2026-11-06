import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { z } from "zod";
import { MULTICALL3_ADDRESS, fromUnits, multicall3Abi, passkeyAccountFactoryAbi, subscriptionManagerAbi, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { invoices, merchants, subscriptions } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { randomHex } from "../lib/crypto";
import { clientIp } from "../lib/request";
import { amountSchema, idSchema, invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { issueAccountToken } from "./account";
import { sendFromTank, type TankSend } from "../relayer/tankSend";
import { eventType } from "../instalments";
import { emitEvent } from "../webhooks";

type Row = typeof subscriptions.$inferSelect;
export const subscriptionView = (r: Row, appUrl: string) => ({
  id: r.id,
  kind: r.kind,
  status: r.status === "subscribing" ? "offered" : r.status,
  amount: fromUnits(BigInt(r.amount)),
  periodSeconds: r.periodSeconds,
  maxCharges: r.maxCharges,
  charges: r.charges,
  payer: r.payer,
  customerEmail: r.customerEmail,
  nextChargeAt: r.status === "active" || r.status === "past_due" ? new Date(r.nextChargeAt * 1000).toISOString() : null,
  subscribeUrl: `${appUrl}/subscribe/${r.id}`,
  createdAt: r.createdAt,
  atRisk: r.atRiskReason ? { reason: r.atRiskReason, since: r.atRiskAt } : null,
  ...(r.kind === "instalment" && r.total
    ? {
        invoiceId: r.invoiceId,
        payerBusinessName: r.payerBusinessName,
        count: r.maxCharges,
        each: fromUnits(BigInt(r.amount)),
        total: fromUnits(BigInt(r.total)),
        rounding: fromUnits(BigInt(r.total) - BigInt(r.amount) * BigInt(r.maxCharges)),
      }
    : {}),
});
const view = subscriptionView;

const createBody = z.strictObject({
  amount: amountSchema,
  periodSeconds: z.number().int().min(60).max(366 * 86_400),
  maxCharges: z.number().int().min(1).max(10_000),
  customerEmail: z.email().max(254).optional(),
});

// ---- merchant (API key or session) --------------------------------------------------------------------------------

export const subscriptionRoutes = new Hono<AppEnv>();

subscriptionRoutes.post("/", async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { merchant, db } = c.var;
  return runIdempotent(c, merchant.id, async () => {
    const now = c.var.now();
    const row: Row = {
      id: `0x${randomHex(32)}`,
      merchantId: merchant.id,
      amount: toUnits(parsed.data.amount).toString(),
      periodSeconds: parsed.data.periodSeconds,
      maxCharges: parsed.data.maxCharges,
      startAt: Math.floor(now.getTime() / 1000), // the first charge is due as soon as the customer subscribes
      customerEmail: parsed.data.customerEmail ?? null,
      payer: null,
      status: "offered",
      charges: 0,
      nextChargeAt: Math.floor(now.getTime() / 1000),
      failedAttempts: 0,
      retryAt: null,
      subscribeTx: null,
      kind: "subscription",
      invoiceId: null,
      payerBusinessName: null,
      total: null,
      atRiskReason: null,
      atRiskAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await db.insert(subscriptions).values(row);
    return { status: 201 as const, body: view(row, c.env.APP_URL) };
  });
});

subscriptionRoutes.get("/", async (c) => {
  const kind = c.req.query("kind");
  if (kind !== undefined && kind !== "subscription" && kind !== "instalment") return fail(c, 400, "invalid_request", "kind must be subscription or instalment");
  const mine = eq(subscriptions.merchantId, c.var.merchantId);
  const rows = await c.var.db.select().from(subscriptions).where(kind ? and(mine, eq(subscriptions.kind, kind)) : mine).orderBy(desc(subscriptions.createdAt), desc(subscriptions.id)).limit(100);
  return c.json({ data: rows.map((r) => view(r, c.env.APP_URL)) });
});

const own = async (c: { var: AppEnv["Variables"]; req: { param(n: string): string } }) => {
  if (!idSchema.safeParse(c.req.param("id")).success) return null;
  const [r] = await c.var.db.select().from(subscriptions).where(and(eq(subscriptions.id, c.req.param("id")), eq(subscriptions.merchantId, c.var.merchantId)));
  return r ?? null;
};

subscriptionRoutes.get("/:id", async (c) => {
  const r = await own(c);
  return r ? c.json(view(r, c.env.APP_URL)) : fail(c, 404, "not_found", "Subscription not found");
});

/** Stops us charging. The customer can always end it themselves onchain; the contract has no merchant-by-signature path. */
subscriptionRoutes.post("/:id/cancel", async (c) => {
  const r = await own(c);
  if (!r) return fail(c, 404, "not_found", "Subscription not found");
  if (r.status === "cancelled" || r.status === "completed") return fail(c, 409, "not_active", `This subscription is already ${r.status}.`);
  const now = c.var.now().toISOString();
  await c.var.db.update(subscriptions).set({ status: "cancelled", updatedAt: now }).where(eq(subscriptions.id, r.id));
  await audit(c.var.db, { merchantId: r.merchantId, actor: `merchant:${r.merchantId}`, action: "subscription.cancelled", payload: { id: r.id } });
  return c.json(view({ ...r, status: "cancelled" }, c.env.APP_URL));
});

// ---- customer (public) --------------------------------------------------------------------------------------------

export const subscriptionPublicRoutes = new Hono<AppEnv>();

subscriptionPublicRoutes.get("/pay/subscription/:id", async (c) => {
  if (!idSchema.safeParse(c.req.param("id")).success) return fail(c, 404, "not_found", "Not found");
  const [r] = await c.var.db.select().from(subscriptions).where(eq(subscriptions.id, c.req.param("id")));
  if (!r) return fail(c, 404, "not_found", "Not found");
  const [m] = await c.var.db.select().from(merchants).where(eq(merchants.id, r.merchantId));
  return c.json({
    id: r.id,
    kind: r.kind,
    ...(r.kind === "instalment" && r.total ? { total: fromUnits(BigInt(r.total)), payerBusinessName: r.payerBusinessName } : {}),
    status: r.status === "subscribing" ? "offered" : r.status,
    merchantName: m?.name ?? "",
    merchantAddress: m?.address ?? null,
    payout: m?.payoutAddress ?? m?.address ?? null,
    amount: fromUnits(BigInt(r.amount)),
    periodSeconds: r.periodSeconds,
    maxCharges: r.maxCharges,
    startAt: r.startAt,
    manager: c.env.SUBSCRIPTION_MANAGER_ADDRESS,
  });
});

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex = z.string().regex(/^0x([0-9a-fA-F]{2}){1,4096}$/);
const digits = z.string().regex(/^\d{1,20}$/);
const subscribeBody = z.strictObject({
  id: idSchema,
  payer: address,
  deadline: digits,
  payerSig: hex,
  permitValue: digits.optional(),
  permitDeadline: digits.optional(),
  permitSig: hex.optional(),
  account: z.strictObject({ qx: word, qy: word, salt: word }).optional(),
});
const cancelBody = z.strictObject({ id: idSchema, deadline: digits, payerSig: hex });

const CODES = { gas_tank_empty: 402, gas_cap_reached: 429, busy: 503, relayer_low: 503, chain_error: 502, tx_reverted: 502, timeout: 504 } as const;
const TEXT: Record<keyof typeof CODES, string> = {
  gas_tank_empty: "This business cannot take sign-ups right now.",
  gas_cap_reached: "This business has reached today's limit. Try again tomorrow.",
  busy: "The service is busy. Try again.",
  relayer_low: "Sign-ups are temporarily unavailable.",
  chain_error: "That could not be sent. Try again.",
  tx_reverted: "That failed.",
  timeout: "This is taking longer than expected. It may still complete.",
};
const failSend = (c: Parameters<typeof fail>[0], r: Extract<TankSend, { ok: false }>) =>
  r.code === "rejected" ? fail(c, 422, "subscription_rejected", "The agreement was rejected: " + r.reason) : fail(c, CODES[r.code], r.code, TEXT[r.code]);

export const subscriptionRelayRoutes = new Hono<AppEnv>();

subscriptionRelayRoutes.post("/subscribe", async (c) => {
  const parsed = subscribeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const { db, chain } = c.var;
  const now = c.var.now();
  if (!(await hitRateLimit(db, `subscribe:ip:${clientIp(c) ?? "unknown"}`, 30, 60, now))) return fail(c, 429, "rate_limited", "Too many attempts. Try again in a minute.");

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, b.id));
  if (!sub) return fail(c, 404, "not_found", "Not found");
  const [m] = await db.select().from(merchants).where(eq(merchants.id, sub.merchantId));
  if (!m?.address) return fail(c, 409, "merchant_not_ready", "This business is not ready yet.");
  if (sub.kind === "instalment") {
    // A plan covers an invoice nobody has paid. If it was paid or cancelled meanwhile, agreeing to it would charge twice.
    const [inv] = sub.invoiceId ? await db.select().from(invoices).where(eq(invoices.id, sub.invoiceId)) : [];
    if (!inv || inv.status !== "open") return fail(c, 409, "invoice_not_payable", "This invoice can no longer be paid in parts.");
  }
  const taken = await db.update(subscriptions).set({ status: "subscribing", updatedAt: now.toISOString() }).where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, "offered"))).returning({ id: subscriptions.id });
  if (taken.length === 0) return fail(c, 409, "not_available", "This subscription is not available.");
  const back = () => db.update(subscriptions).set({ status: "offered" }).where(eq(subscriptions.id, sub.id));

  const subscribeData = encodeFunctionData({
    abi: subscriptionManagerAbi,
    functionName: "subscribe",
    args: [
      sub.id as Hex,
      { payer: b.payer as Address, merchant: m.address as Address, payout: (m.payoutAddress ?? m.address) as Address, amount: BigInt(sub.amount), periodSeconds: sub.periodSeconds, startAt: BigInt(sub.startAt), maxCharges: sub.maxCharges },
      BigInt(b.deadline),
      b.payerSig as Hex,
      BigInt(b.permitValue ?? "0"),
      BigInt(b.permitDeadline ?? "0"),
      (b.permitSig ?? "0x") as Hex,
    ],
  });
  let call = { to: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, data: subscribeData };
  try {
    if (b.account && !(await chain.hasCode(b.payer as Address))) {
      const expected = await chain.passkeyAddress(b.account.qx as Hex, b.account.qy as Hex, b.account.salt as Hex);
      if (expected.toLowerCase() !== b.payer.toLowerCase()) {
        await back();
        return fail(c, 422, "account_mismatch", "The account details do not match the payer.");
      }
      const create = encodeFunctionData({ abi: passkeyAccountFactoryAbi, functionName: "createAccount", args: [b.account.qx as Hex, b.account.qy as Hex, b.account.salt as Hex] });
      call = {
        to: MULTICALL3_ADDRESS,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [[{ target: c.env.FACTORY_ADDRESS as Address, allowFailure: false, callData: create }, { target: call.to, allowFailure: false, callData: subscribeData }]],
        }),
      };
    }
  } catch (e) {
    await back();
    console.error("account lookup failed", e);
    return fail(c, 502, "chain_error", TEXT.chain_error);
  }

  const sent = await sendFromTank({ db, chain, now }, sub.merchantId, call);
  if (!sent.ok) {
    if (sent.code !== "timeout") await back(); // a timeout may still land: leave it held
    return failSend(c, sent);
  }
  await db.update(subscriptions).set({ status: "active", payer: b.payer, subscribeTx: sent.txHash, updatedAt: now.toISOString() }).where(eq(subscriptions.id, sub.id));
  await audit(db, { merchantId: sub.merchantId, actor: `payer:${b.payer}`, action: "subscription.created", payload: { id: sub.id, txHash: sent.txHash } });
  await emitEvent(db, c.env.WEBHOOKS, sub.merchantId, { id: `evt_sub_created_${sub.id}`, type: eventType(sub.kind, sub.kind === "instalment" ? "started" : "created"), data: { subscription: view({ ...sub, status: "active", payer: b.payer }, c.env.APP_URL) } });
  const accountToken = await issueAccountToken(c.env, b.payer, now);
  return c.json({ status: "active", txHash: sent.txHash, ...(accountToken ? { accountToken } : {}) });
});

subscriptionRelayRoutes.post("/subscription-cancel", async (c) => {
  const parsed = cancelBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const { db, chain } = c.var;
  const now = c.var.now();
  if (!(await hitRateLimit(db, `subscribe:ip:${clientIp(c) ?? "unknown"}`, 30, 60, now))) return fail(c, 429, "rate_limited", "Too many attempts. Try again in a minute.");
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, b.id));
  // The customer can always end it onchain, even if the business stopped charging (its dashboard row says cancelled): only
  // the contract knows whether it is still running, and it refuses a second cancel.
  if (!sub || !sub.payer || sub.status === "offered" || sub.status === "subscribing" || sub.status === "completed") return fail(c, 404, "not_found", "Not found");

  const data = encodeFunctionData({ abi: subscriptionManagerAbi, functionName: "cancelWithSig", args: [sub.id as Hex, BigInt(b.deadline), b.payerSig as Hex] });
  const sent = await sendFromTank({ db, chain, now }, sub.merchantId, { to: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, data });
  if (!sent.ok) return failSend(c, sent);
  await db.update(subscriptions).set({ status: "cancelled", updatedAt: now.toISOString() }).where(eq(subscriptions.id, sub.id));
  await audit(db, { merchantId: sub.merchantId, actor: `payer:${sub.payer}`, action: "subscription.cancelled", payload: { id: sub.id, txHash: sent.txHash } });
  await emitEvent(db, c.env.WEBHOOKS, sub.merchantId, { id: `evt_sub_cancelled_${sub.id}`, type: eventType(sub.kind, "cancelled"), data: { subscription: view({ ...sub, status: "cancelled" }, c.env.APP_URL) } });
  return c.json({ status: "cancelled", txHash: sent.txHash });
});
