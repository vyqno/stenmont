import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { zeroAddress, hashTypedData, encodeFunctionData, type Address, type Hex } from "viem";
import { z } from "zod";
import { MULTICALL3_ADDRESS, fromUnits, multicall3Abi, passkeyAccountFactoryAbi, paymentRouterAbi, routerDomain, subscriptionManagerAbi, subscriptionDomain, toUnits } from "@stenmont/shared";
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
import { agreementSegments, eventType, readAgreementState, splitInstalments } from "../instalments";
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
        first: fromUnits(BigInt(agreementSegments(r)[0]!.amount)),
        rounding: "0",
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
      segments: null,
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

/** Stop the original invoice rail before deriving the final replacement terms. A pending quote is never activated. */
subscriptionRoutes.get("/:id/prepare-terms", async c => {
  const row = await own(c);
  if (!row || row.kind !== "instalment" || !row.invoiceId || row.status !== "offered") return fail(c, 409, "not_available", "No offered replacement plan.");
  const deadline = Math.floor(c.var.now().getTime() / 1000) + 600;
  const digest = hashTypedData({ domain: routerDomain(c.env.ROUTER_ADDRESS as Address), types: { CancelInvoice: [{ name: "id", type: "bytes32" }, { name: "deadline", type: "uint256" }] }, primaryType: "CancelInvoice", message: { id: row.invoiceId as Hex, deadline: BigInt(deadline) } });
  return c.json({ deadline: String(deadline), digest });
});
subscriptionRoutes.post("/:id/prepare", async c => {
  const row = await own(c);
  if (!row || row.kind !== "instalment" || !row.invoiceId || row.status !== "offered") return fail(c, 409, "not_available", "No offered replacement plan.");
  const parsed = z.strictObject({ deadline: z.string().regex(/^\d{1,20}$/), signature: z.string().regex(/^0x([0-9a-fA-F]{2}){1,4096}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, chain } = c.var;
  const before = await chain.invoiceState(row.invoiceId as Hex);
  if (before.hook !== zeroAddress) return fail(c, 409, "financed_invoice", "Financed invoices cannot use this replacement rail.");
  if (before.status === 1) {
    const sent = await sendFromTank({ db, chain, now: c.var.now() }, row.merchantId, { to: c.env.ROUTER_ADDRESS as Address, data: encodeFunctionData({ abi: paymentRouterAbi, functionName: "cancel", args: [row.invoiceId as Hex, BigInt(parsed.data.deadline), parsed.data.signature as Hex] }) });
    if (!sent.ok) return failSend(c, sent);
  }
  // Read after the confirmed cancellation: a partial payment mined before it must reduce the offer.
  const final = await chain.invoiceState(row.invoiceId as Hex);
  if (final.status !== 3 || final.hook !== zeroAddress) return fail(c, 409, "invoice_not_cancelled", "The original invoice has not been confirmed cancelled. Retry after confirmation.");
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, row.invoiceId));
  if (!invoice) return fail(c, 404, "not_found", "Invoice not found.");
  const total = BigInt(invoice.amount) - final.paid;
  const { each, first, rounding } = splitInstalments(total, row.maxCharges);
  if (each <= 0n) return fail(c, 422, "too_small_to_split", "The remaining amount is too small.");
  const startAt = Math.floor(c.var.now().getTime() / 1000);
  const segments = rounding === 0n ? null : JSON.stringify([{ id: row.id, amount: first.toString(), maxCharges: 1, startAt }, { id: `0x${randomHex(32)}`, amount: each.toString(), maxCharges: row.maxCharges - 1, startAt: startAt + row.periodSeconds }]);
  await db.update(subscriptions).set({ amount: each.toString(), total: total.toString(), segments, startAt, nextChargeAt: startAt, updatedAt: c.var.now().toISOString() }).where(and(eq(subscriptions.id, row.id), eq(subscriptions.status, "offered")));
  await db.update(invoices).set({ status: "cancelled", amountPaid: final.paid.toString() }).where(eq(invoices.id, invoice.id));
  const [fresh] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
  return c.json({ ...view(fresh!, c.env.APP_URL), rail: "replacement_subscription", originalInvoiceStatus: "cancelled" });
});

/** Prepare signatures that cancel every active fixed-amount agreement, including a split plan's second agreement. */
subscriptionRoutes.get("/:id/cancel-terms", async c => {
  const row = await own(c);
  if (!row) return fail(c, 404, "not_found", "Subscription not found");
  const deadline = Math.floor(c.var.now().getTime() / 1000) + 600;
  const agreements = [];
  for (const segment of agreementSegments(row)) {
    if ((await c.var.chain.subscriptionState(segment.id as Hex)).status !== "active") continue;
    const digest = hashTypedData({ domain: subscriptionDomain(c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address), types: { MerchantCancelSubscription: [{ name: "id", type: "bytes32" }, { name: "deadline", type: "uint256" }] }, primaryType: "MerchantCancelSubscription", message: { id: segment.id as Hex, deadline: BigInt(deadline) } });
    agreements.push({ id: segment.id, digest });
  }
  return c.json({ deadline: String(deadline), agreements });
});
/** An offered agreement can be withdrawn locally. Active instalments require merchant signatures and onchain cancellation. */
subscriptionRoutes.post("/:id/cancel", async (c) => {
  const r = await own(c);
  if (!r) return fail(c, 404, "not_found", "Subscription not found");
  if (r.status === "cancelled" || r.status === "completed") return fail(c, 409, "not_active", `This subscription is already ${r.status}.`);
  if (r.kind === "instalment" && r.payer) {
    const parsed = z.strictObject({ deadline: z.string().regex(/^\d{1,20}$/), signatures: z.array(z.strictObject({ id: idSchema, signature: z.string().regex(/^0x([0-9a-fA-F]{2}){1,4096}$/) })).max(2) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "signatures_required", "Sign cancellation of every active agreement first.");
    const b = parsed.data;
    const calls = [];
    for (const segment of agreementSegments(r)) {
      if ((await c.var.chain.subscriptionState(segment.id as Hex)).status !== "active") continue;
      const signature = b.signatures.find(s => s.id === segment.id)?.signature;
      if (!signature) return fail(c, 400, "signatures_required", "Every active agreement must be cancelled together.");
      calls.push({ target: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, allowFailure: false, callData: encodeFunctionData({ abi: subscriptionManagerAbi, functionName: "cancelWithMerchantSig", args: [segment.id as Hex, BigInt(b.deadline), signature as Hex] }) });
    }
    if (calls.length) {
      const data = encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
      const sent = await sendFromTank({ db: c.var.db, chain: c.var.chain, now: c.var.now() }, r.merchantId, { to: MULTICALL3_ADDRESS, data });
      if (!sent.ok) return failSend(c, sent);
    }
  }
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
  let preparationRequired = false;
  if (r.kind === "instalment" && r.invoiceId && r.status === "offered") {
    const state = await c.var.chain.invoiceState(r.invoiceId as Hex);
    const [invoice] = await c.var.db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    preparationRequired = state.status !== 3 || state.hook !== zeroAddress || !invoice || BigInt(invoice.amount) - state.paid !== BigInt(r.total ?? "0");
  }
  return c.json({
    preparationRequired,
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
    ...(r.kind === "instalment" ? { segments: agreementSegments(r).map(s => ({ ...s, amount: fromUnits(BigInt(s.amount)) })) } : {}),
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
  segmentSignatures: z.array(hex).min(1).max(2).optional(),
  permitValue: digits.optional(),
  permitDeadline: digits.optional(),
  permitSig: hex.optional(),
  account: z.strictObject({ qx: word, qy: word, salt: word }).optional(),
});
const cancelBody = z.strictObject({ id: idSchema, deadline: digits, payerSig: hex, segmentSignatures: z.array(hex).min(1).max(2).optional() });

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
    if (!inv || !["open", "partially_paid", "cancelled"].includes(inv.status)) return fail(c, 409, "invoice_not_payable", "This invoice can no longer be paid in parts.");
  }
  if (sub.kind === "instalment" && sub.invoiceId) {
    const onchain = await chain.invoiceState(sub.invoiceId as Hex);
    if (onchain.hook !== zeroAddress) return fail(c, 409, "financed_invoice", "A financed invoice must be paid through its invoice link.");
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, sub.invoiceId));
    if (onchain.status !== 3 || !invoice || BigInt(invoice.amount) - onchain.paid !== BigInt(sub.total ?? "0")) return fail(c, 409, "prepare_required", "The business must cancel the original invoice and refresh the final replacement terms before you agree.");
  }
  const segments = agreementSegments(sub);
  if (segments.length > 1 && b.segmentSignatures?.length !== segments.length) return fail(c, 400, "signatures_required", "Sign both fixed-amount agreements to start this plan.");
  const taken = await db.update(subscriptions).set({ status: "subscribing", updatedAt: now.toISOString() }).where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, "offered"))).returning({ id: subscriptions.id });
  if (taken.length === 0) return fail(c, 409, "not_available", "This subscription is not available.");
  const back = () => db.update(subscriptions).set({ status: "offered" }).where(eq(subscriptions.id, sub.id));

  const registrations = segments.map((segment, index) => encodeFunctionData({
    abi: subscriptionManagerAbi, functionName: "subscribe",
    args: [segment.id as Hex,
      { payer: b.payer as Address, merchant: m.address as Address, payout: (m.payoutAddress ?? m.address) as Address, amount: BigInt(segment.amount), periodSeconds: sub.periodSeconds, startAt: BigInt(segment.startAt), maxCharges: segment.maxCharges },
      BigInt(b.deadline), (b.segmentSignatures?.[index] ?? b.payerSig) as Hex,
      BigInt(index === 0 ? (b.permitValue ?? "0") : "0"), BigInt(b.permitDeadline ?? "0"), (index === 0 ? (b.permitSig ?? "0x") : "0x") as Hex],
  }));
  const calls = registrations.map(data => ({ target: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, allowFailure: false, callData: data }));
  if (sub.kind === "instalment" && sub.startAt <= Math.floor(now.getTime() / 1000)) calls.push({ target: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, allowFailure: false, callData: encodeFunctionData({ abi: subscriptionManagerAbi, functionName: "charge", args: [segments[0]!.id as Hex] }) });
  let call = calls.length === 1 ? { to: calls[0]!.target, data: calls[0]!.callData } : { to: MULTICALL3_ADDRESS, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] }) };
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
          args: [[{ target: c.env.FACTORY_ADDRESS as Address, allowFailure: false, callData: create }, ...calls]],
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
  if (sub.kind === "instalment" && sub.startAt <= Math.floor(now.getTime() / 1000)) {
    const state = await readAgreementState(chain, sub);
    await db.update(subscriptions).set({ charges: state.charges, nextChargeAt: Number(state.nextCharge), status: state.status }).where(eq(subscriptions.id, sub.id));
    await emitEvent(db, c.env.WEBHOOKS, sub.merchantId, { id: `evt_inst_${sub.id}_1`, type: "instalment.charged", data: { instalment: { id: sub.id, invoiceId: sub.invoiceId, number: 1, of: sub.maxCharges, amount: fromUnits(BigInt(segments[0]!.amount)) }, txHash: sent.txHash } });
  }
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

  const segments = agreementSegments(sub);
  if (segments.length > 1 && b.segmentSignatures?.length !== segments.length) return fail(c, 400, "signatures_required", "Sign cancellation of both agreements.");
  const calls: { target: Address; allowFailure: boolean; callData: Hex }[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segments.length > 1 && (await chain.subscriptionState(segment.id as Hex)).status !== "active") continue;
    calls.push({ target: c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address, allowFailure: false, callData: encodeFunctionData({ abi: subscriptionManagerAbi, functionName: "cancelWithSig", args: [segment.id as Hex, BigInt(b.deadline), (b.segmentSignatures?.[index] ?? b.payerSig) as Hex] }) });
  }
  if (calls.length === 0) return fail(c, 409, "not_active", "No active agreements remain.");
  const data = calls.length === 1 ? calls[0]!.callData : encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
  const sent = await sendFromTank({ db, chain, now }, sub.merchantId, { to: calls.length === 1 ? c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address : MULTICALL3_ADDRESS, data });
  if (!sent.ok) return failSend(c, sent);
  await db.update(subscriptions).set({ status: "cancelled", updatedAt: now.toISOString() }).where(eq(subscriptions.id, sub.id));
  await audit(db, { merchantId: sub.merchantId, actor: `payer:${sub.payer}`, action: "subscription.cancelled", payload: { id: sub.id, txHash: sent.txHash } });
  await emitEvent(db, c.env.WEBHOOKS, sub.merchantId, { id: `evt_sub_cancelled_${sub.id}`, type: eventType(sub.kind, "cancelled"), data: { subscription: view({ ...sub, status: "cancelled" }, c.env.APP_URL) } });
  return c.json({ status: "cancelled", txHash: sent.txHash });
});
