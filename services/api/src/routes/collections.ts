import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { sessionMerchant } from "../auth";
import { audit } from "../audit";
import { collectionsActions, collectionsPolicy, ensNames, invoices } from "../db/schema";
import { fail } from "../errors";
import { idSchema, invalid } from "../lib/validation";
import { requireApproval } from "../world/approvals";
import { d1ApprovalRepo } from "../world/d1";

export const collectionsRoutes = new Hono<AppEnv>();
const policyBody = z.strictObject({ maxDiscountBps: z.number().int().min(0).max(10000), maxInstalments: z.number().int().min(0).max(3), maxExtensionDays: z.number().int().min(0).max(366) });
const planBody = z.strictObject({ invoiceId: idSchema, instalments: z.number().int().min(2).max(3), extensionDays: z.number().int().min(0).max(366).default(0), b2b: z.literal(true), payerBusinessName: z.string().trim().min(2).max(200) });
const defaultPolicy = { maxDiscountBps: 0, maxInstalments: 0, maxExtensionDays: 0 };

collectionsRoutes.get("/overdue", async c => {
  const rows = await c.var.db.select().from(invoices).where(and(eq(invoices.merchantId, c.var.merchantId), inArray(invoices.status, ["open", "partially_paid"]), lt(invoices.dueDate, c.var.now().toISOString()))).orderBy(invoices.dueDate).limit(100);
  return c.json({ data: rows.filter(r => BigInt(r.amount) > BigInt(r.amountPaid)).map(r => ({ id: r.id, dueDate: r.dueDate, outstanding: fromUnits(BigInt(r.amount) - BigInt(r.amountPaid)), customerEmail: r.customerEmail })) });
});
collectionsRoutes.get("/actions", async c => c.json({ data: await c.var.db.select().from(collectionsActions).where(eq(collectionsActions.merchantId, c.var.merchantId)).orderBy(desc(collectionsActions.createdAt)).limit(100), deliveryMode: "draft_only" }));
collectionsRoutes.get("/policy", async c => {
  const [row] = await c.var.db.select().from(collectionsPolicy).where(eq(collectionsPolicy.merchantId, c.var.merchantId));
  return c.json(row ?? defaultPolicy);
});
collectionsRoutes.post("/policy", async c => {
  if (!(await sessionMerchant(c))) return fail(c, 403, "human_required", "Sign in with a passkey to change collections policy.");
  const parsed = policyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const row = { merchantId: c.var.merchantId, ...parsed.data, updatedAt: c.var.now().toISOString() };
  await c.var.db.insert(collectionsPolicy).values(row).onConflictDoUpdate({ target: collectionsPolicy.merchantId, set: row });
  return c.json(row);
});
collectionsRoutes.post("/policy/publish", async c => {
  if (!(await sessionMerchant(c))) return fail(c, 403, "human_required", "Sign in with a passkey to publish policy.");
  const [name] = await c.var.db.select().from(ensNames).where(eq(ensNames.merchantId, c.var.merchantId));
  if (name?.status !== "active") return fail(c, 409, "no_name", "Claim a business name first.");
  const [policy] = await c.var.db.select().from(collectionsPolicy).where(eq(collectionsPolicy.merchantId, c.var.merchantId));
  const { maxDiscountBps, maxInstalments, maxExtensionDays } = policy ?? defaultPolicy;
  try {
    const txHash = await c.var.ens.setTextRecords({ name: name.name, resolver: name.resolver as Address, records: { "stenmont.collections": JSON.stringify({ version: 1, maxDiscountBps, maxInstalments, maxExtensionDays, merchantApprovalRequired: true, deliveryMode: "draft_only" }) } });
    return c.json({ status: "published", txHash });
  } catch { return fail(c, 502, "publish_failed", "Policy was saved locally; ENS publication failed. Older locked names may need new registrar permissions."); }
});

for (const kind of ["reminders", "plans"] as const) collectionsRoutes.post(`/${kind}`, async c => {
  const parsed = (kind === "plans" ? planBody : z.strictObject({ invoiceId: idSchema })).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const [invoice] = await c.var.db.select().from(invoices).where(and(eq(invoices.id, parsed.data.invoiceId), eq(invoices.merchantId, c.var.merchantId)));
  if (!invoice) return fail(c, 404, "not_found", "Invoice not found.");
  if (!["open", "partially_paid"].includes(invoice.status) || BigInt(invoice.amountPaid) >= BigInt(invoice.amount)) return fail(c, 409, "not_payable", "This invoice no longer needs collection.");
  const terms = kind === "plans" ? planBody.parse(parsed.data) : {};
  let exception = 0;
  if (kind === "plans") {
    const p = planBody.parse(terms);
    const [policy] = await c.var.db.select().from(collectionsPolicy).where(eq(collectionsPolicy.merchantId, c.var.merchantId));
    const limits = policy ?? defaultPolicy;
    if (p.instalments > limits.maxInstalments || p.extensionDays > limits.maxExtensionDays) {
      const approvalParams = { ...p, outstanding: (BigInt(invoice.amount) - BigInt(invoice.amountPaid)).toString() };
      const approved = await requireApproval(d1ApprovalRepo(c.var.db), { merchantId: c.var.merchantId, operation: "collections_exception", params: approvalParams, now: c.var.now() });
      if (!approved.ok) return fail(c, 403, approved.code, approved.message, { approvalParams });
      exception = 1;
    }
  }
  // Descriptions, invoice metadata, and payer legal names are untrusted data. None is interpolated into instructions or HTML.
  const amount = fromUnits(BigInt(invoice.amount) - BigInt(invoice.amountPaid));
  const row = { id: crypto.randomUUID(), merchantId: c.var.merchantId, invoiceId: invoice.id, kind: kind === "plans" ? "instalments" : "reminder", status: "pending", toEmail: invoice.customerEmail, subject: "Invoice payment reminder", message: `An outstanding invoice balance of ${amount} USD is awaiting payment. Please review the payment link or contact the business.`, terms: JSON.stringify(terms), link: `${c.env.APP_URL}/pay/${invoice.id}`, exception, createdAt: c.var.now().toISOString() };
  await c.var.db.insert(collectionsActions).values(row);
  await audit(c.var.db, { merchantId: c.var.merchantId, actor: "collections", action: "collections.drafted", payload: { id: row.id, kind: row.kind, exception } });
  return c.json(row, 201);
});
collectionsRoutes.post("/actions/:id/decide", async c => {
  const person = await sessionMerchant(c);
  if (!person || person.id !== c.var.merchantId) return fail(c, 403, "human_required", "Only the business can approve a collection draft.");
  const parsed = z.strictObject({ decision: z.enum(["approve", "deny"]) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const rows = await c.var.db.update(collectionsActions).set({ status: parsed.data.decision === "approve" ? "approved" : "denied", decidedAt: c.var.now().toISOString() }).where(and(eq(collectionsActions.id, c.req.param("id")), eq(collectionsActions.merchantId, person.id), eq(collectionsActions.status, "pending"))).returning();
  if (!rows[0]) return fail(c, 409, "not_pending", "This draft is unavailable or has already been decided.");
  await audit(c.var.db, { merchantId: person.id, actor: `merchant:${person.id}`, action: "collections.decided", payload: { id: rows[0].id, status: rows[0].status } });
  // Approval records intent only. There is no delivery adapter or money-moving execution here.
  return c.json(rows[0]);
});
