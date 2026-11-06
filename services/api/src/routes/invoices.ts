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
import { emitEvent } from "../webhooks";

const createSchema = z.strictObject({
  amount: amountSchema,
  number: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
  customerEmail: z.email().max(254).optional(),
  dueDate: z.iso.datetime().optional(),
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
        payout: (merchant.payoutAddress ?? merchant.address) as Address,
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
