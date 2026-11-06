import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { keccak256, toBytes, zeroAddress, type Address } from "viem";
import { z } from "zod";
import { invoiceId, invoiceRef, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { invoices } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { randomHex } from "../lib/crypto";
import { amountSchema, idSchema, invalid, returnUrlOk } from "../lib/validation";
import { invoiceView } from "../lib/views";
import { hitRateLimit } from "../relayer/caps";
import { d1WorldRepo } from "../world/d1";
import { assertDifferentHumans } from "../world/samehuman";
import { ensNames, merchants } from "../db/schema";
import { emitEvent } from "../webhooks";
import { isPaused } from "../sites/switch";

const createSchema = z.strictObject({
  amount: amountSchema,
  number: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
  customerEmail: z.email().max(254).optional(),
  dueDate: z.iso.datetime().optional(),
  /** Who gets paid: the business's own ENS name (resolved now) or its own payout address. Anything else is refused. */
  payTo: z.string().max(100).optional(),
  buyerMerchantId: z.string().max(80).optional(),
  successUrl: z.string().max(2048).optional(),
  cancelUrl: z.string().max(2048).optional(),
  metadata: z
    .record(z.string().max(40), z.string().max(500))
    .refine((m) => Object.keys(m).length <= 10, "at most 10 keys")
    .optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["open", "partially_paid", "paid", "cancelled", "failed"]).optional(),
});

export const invoiceRoutes = new Hono<AppEnv>();

invoiceRoutes.post("/", async (c) => {
  // The business can pause payments (dashboard switch): no new invoices or checkout sessions until it resumes.
  if (await isPaused(c.var.db, c.var.merchantId)) return fail(c, 403, "payments_paused", "Payments are paused for this business. Resume them in the dashboard.");
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const input = parsed.data;
  const { db, chain, merchant } = c.var;
  for (const u of [input.successUrl, input.cancelUrl]) {
    if (u !== undefined && !returnUrlOk(u, c.env.ENVIRONMENT)) {
      return fail(c, 400, "invalid_request", "successUrl and cancelUrl must be public https addresses");
    }
  }

  return runIdempotent(c, merchant.id, async () => {
    // Every invoice is a transaction paid by the platform, so creation is limited per business and overall.
    const at = c.var.now();
    const within = [
      await hitRateLimit(db, `invoices:m:${merchant.id}`, 60, 60, at),
      await hitRateLimit(db, `invoices:day:${merchant.id}`, 2_000, 86_400, at),
      await hitRateLimit(db, "invoices:global", 20_000, 86_400, at),
    ];
    if (within.includes(false)) return fail(c, 429, "rate_limited", "Too many invoices created. Try again in a minute.");
    // An invoice between two businesses run by the same person is not a real sale: refuse it (World ID, one person one business).
    if (input.buyerMerchantId) {
      const [buyer] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, input.buyerMerchantId));
      if (!buyer) return fail(c, 404, "buyer_not_found", "The buyer business was not found");
      const same = await assertDifferentHumans(d1WorldRepo(db), buyer.id, merchant.id);
      if (!same.ok) return fail(c, 422, "same_human", "The buyer and the supplier are the same person, so this invoice cannot be created.");
    }
    // Payee: default is the business's payout. A name must be the business's own, and is resolved now, so later changes to the
    // record only affect later invoices. Nothing a caller sends can point the money at an address that is not already theirs.
    let payout = (merchant.payoutAddress ?? merchant.address) as Address | null;
    let payeeName: string | null = null;
    if (input.payTo !== undefined) {
      const mine = (merchant.payoutAddress ?? "").toLowerCase();
      if (/^0x[0-9a-fA-F]{40}$/.test(input.payTo)) {
        if (input.payTo.toLowerCase() !== mine) return fail(c, 400, "payee_not_allowed", "payTo must be your own name or payout address");
      } else {
        const [own] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchant.id));
        if (!own || own.status !== "active" || own.name !== input.payTo) return fail(c, 400, "payee_not_allowed", "payTo must be your own name or payout address");
        const resolved = await c.var.ens.resolveAddress(own.name);
        if (!resolved) return fail(c, 422, "payee_not_found", `${own.name} does not resolve to an address right now`);
        payout = resolved;
        payeeName = own.name;
      }
    }
    if (!merchant.address) return fail(c, 409, "merchant_not_ready", "This merchant has no onchain address yet");
    const merchantAddress = merchant.address as Address;
    const number = input.number ?? `INV-${Date.now().toString(36).toUpperCase()}${randomHex(2).toUpperCase()}`;
    const id = invoiceId(merchantAddress, number);

    const [taken] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.merchantId, merchant.id), eq(invoices.number, number)));
    if (taken) return fail(c, 409, "invoice_number_taken", `Invoice number ${number} is already used`);

    const amount = toUnits(input.amount);
    const now = new Date();
    const metaHash = keccak256(
      toBytes(JSON.stringify({ number, amount: input.amount, customerEmail: input.customerEmail ?? null, metadata: input.metadata ?? {} })),
    );
    await db.insert(invoices).values({
      id,
      merchantId: merchant.id,
      number,
      status: "creating",
      amount: amount.toString(),
      customerEmail: input.customerEmail ?? null,
      dueDate: input.dueDate ?? null,
      payeeName,
      buyerMerchantId: input.buyerMerchantId ?? null,
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
      metaHash,
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    let txHash: `0x${string}`;
    try {
      ({ txHash } = await chain.createInvoice({
        merchant: merchantAddress,
        ref: invoiceRef(number),
        payout: payout as Address,
        payerLock: zeroAddress,
        amount,
        minPayment: 0n,
        dueDate: input.dueDate ? BigInt(Math.floor(Date.parse(input.dueDate) / 1000)) : 0n,
        metaHash,
        deadline: BigInt(Math.floor(now.getTime() / 1000) + 3600),
      }));
    } catch (e) {
      console.error("createInvoice failed", e);
      await db.update(invoices).set({ status: "failed", updatedAt: new Date().toISOString() }).where(eq(invoices.id, id));
      return fail(c, 502, "chain_error", "Could not create the invoice onchain. Try again.");
    }

    await db
      .update(invoices)
      .set({ status: "open", createTxHash: txHash, updatedAt: new Date().toISOString() })
      .where(eq(invoices.id, id));
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    const view = invoiceView(row!, c.env);
    await audit(db, { merchantId: merchant.id, actor: `merchant:${merchant.id}`, action: "invoice.created", payload: { id, number, txHash } });
    await emitEvent(db, c.env.WEBHOOKS, merchant.id, { id: `evt_created_${id}`, type: "invoice.created", data: { invoice: view } });
    return { status: 201 as const, body: view };
  });
});

invoiceRoutes.get("/", async (c) => {
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error);
  const { limit, status } = parsed.data;
  const rows = await c.var.db
    .select()
    .from(invoices)
    .where(status ? and(eq(invoices.merchantId, c.var.merchantId), eq(invoices.status, status)) : eq(invoices.merchantId, c.var.merchantId))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(limit);
  return c.json({ data: rows.map((r) => invoiceView(r, c.env)) });
});

invoiceRoutes.get("/:id", async (c) => {
  if (!idSchema.safeParse(c.req.param("id")).success) return fail(c, 404, "not_found", "Invoice not found");
  const [row] = await c.var.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, c.req.param("id")), eq(invoices.merchantId, c.var.merchantId)));
  if (!row) return fail(c, 404, "not_found", "Invoice not found");
  return c.json(invoiceView(row, c.env));
});
