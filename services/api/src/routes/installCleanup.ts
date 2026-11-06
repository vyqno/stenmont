import { and, eq, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { zeroAddress, type Hex } from "viem";
import { z } from "zod";
import type { AppEnv } from "../app";
import {invoiceProtocol,versionChain} from "../protocol";
import { audit } from "../audit";
import { idempotencyKeys, invoices } from "../db/schema";
import { fail } from "../errors";
import { toUnits } from "@stenmont/shared";
import { sha256Hex } from "../lib/crypto";
import { idSchema, invalid } from "../lib/validation";

// This is maintenance for the isolated staging proof, not a production expiry policy.
export const INSTALL_UNPAID_TTL_MS = 15 * 60_000;
export const INSTALL_CREATING_TTL_MS = 10 * 60_000;
const HOST = "install-proof-staging.stenmont.com";
const creationRequest = z.strictObject({ amount: z.string().regex(/^\d+(?:\.\d{1,6})?$/), successUrl: z.string().max(2048), cancelUrl: z.string().max(2048), metadata: z.strictObject({ order: z.string().max(100) }) });
const body = z.strictObject({ creationKey: z.string().min(1).max(255).optional(), creationRequest: creationRequest.optional() });
export const installCleanupRoutes = new Hono<AppEnv>();

installCleanupRoutes.post("/:id/expire-install", async (c) => {
  if (c.env.ENVIRONMENT !== "staging") return fail(c, 404, "not_found", "Not found");
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return fail(c, 404, "not_found", "Invoice not found");
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, merchantId, chain } = c.var;
  const own = and(eq(invoices.id, id), eq(invoices.merchantId, merchantId));
  const [row] = await db.select().from(invoices).where(own);
  if (!row) return fail(c, 404, "not_found", "Invoice not found");
  const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  if (!row.successUrl || !URL.canParse(row.successUrl) || new URL(row.successUrl).hostname !== HOST || typeof metadata.order !== "string") {
    return fail(c, 400, "not_install_invoice", "Only the isolated staging install store can use this cleanup.");
  }
  const unchanged = () => c.json({ id, status: row.status, changed: false, creationReleased: false });
  if (!["open", "creating"].includes(row.status) || BigInt(row.amountPaid) !== 0n) return unchanged();
  const now = c.var.now();
  const grace = row.status === "creating" ? INSTALL_CREATING_TTL_MS : INSTALL_UNPAID_TTL_MS;
  if (now.getTime() - Date.parse(row.createdAt) < grace) return unchanged();
  let fingerprint: string | undefined;
  if (row.status === "creating") {
    const original = parsed.data.creationRequest;
    if (!parsed.data.creationKey || !original || original.metadata.order !== metadata.order || original.successUrl !== row.successUrl || original.cancelUrl !== row.cancelUrl || toUnits(original.amount) !== BigInt(row.amount)) {
      return fail(c, 409, "creation_reference_required", "The original install checkout request is required; nothing was changed.");
    }
    fingerprint = await sha256Hex(`POST /v1/invoices\n${JSON.stringify(original)}`);
    const [reservation] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.key, parsed.data.creationKey)));
    if (!reservation || reservation.fingerprint !== fingerprint || reservation.response !== "") {
      return fail(c, 409, "creation_key_mismatch", "That key does not belong to this unfinished creation; nothing was changed.");
    }
  }
  let live;
  try { live = await versionChain(chain,invoiceProtocol(c.env,row).version,invoiceProtocol(c.env,row).router,c.env.ROUTER_ADDRESS).invoiceState(id as Hex); }
  catch { return fail(c, 503, "chain_unavailable", "Chain state could not be checked; nothing was changed."); }
  if (live.paid !== 0n || live.status === 2 || live.hook.toLowerCase() !== zeroAddress) return unchanged();
  const status = row.status === "creating" ? "failed" : "expired";
  const at = now.toISOString();
  // A concurrently indexed payment wins. Never retire a transaction awaiting indexing.
  const safe = and(own, eq(invoices.status, row.status), eq(invoices.amountPaid, "0"), eq(invoices.updatedAt, row.updatedAt),
    sql`NOT EXISTS (SELECT 1 FROM relayer_txs WHERE invoice_id = ${id} AND kind IN ('pay','deploy_pay') AND status IN ('pending','sent','success'))`);
  const update = db.update(invoices).set({ status, updatedAt: at }).where(safe).returning({ id: invoices.id });
  let changed: { id: string }[];
  let released = false;
  if (status === "failed" && parsed.data.creationKey) {
    const results = await db.batch([update,
      db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.key, parsed.data.creationKey),
        eq(idempotencyKeys.response, ""), eq(idempotencyKeys.fingerprint, fingerprint!), lte(idempotencyKeys.createdAt, new Date(now.getTime() - INSTALL_CREATING_TTL_MS).toISOString()),
        sql`EXISTS (SELECT 1 FROM invoices WHERE id = ${id} AND merchant_id = ${merchantId} AND status = 'failed' AND updated_at = ${at})`)).returning({ key: idempotencyKeys.key }),
    ]);
    changed = results[0]; released = results[1].length > 0;
  } else changed = await update;
  if (!changed.length) return unchanged();
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: `invoice.install_${status}`, payload: { id, creationReleased: released, onchainStatus: live.status } });
  return c.json({ id, status, changed: true, creationReleased: released, onchainCancelled: false });
});
