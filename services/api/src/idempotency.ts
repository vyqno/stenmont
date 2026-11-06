import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "./app";
import { fail } from "./errors";
import { idempotencyKeys } from "./db/schema";
import { sha256Hex } from "./lib/crypto";

export type IdempotentResult = { status: 200 | 201; body: unknown };

/**
 * Runs `handler` at most once per (Idempotency-Key, merchant). A repeat returns the stored response; a concurrent
 * duplicate gets 409 until the first finishes. If the handler throws, the key is released so the client can retry.
 */
export async function runIdempotent(
  c: Context<AppEnv>,
  merchantId: string,
  handler: () => Promise<IdempotentResult | Response>,
): Promise<Response> {
  const key = c.req.header("idempotency-key");
  if (!key || key.length > 255) {
    return fail(c, 400, "idempotency_key_required", "Send an Idempotency-Key header (up to 255 characters)");
  }
  const db = c.var.db;
  // A key is for one request: reusing it for a different route or body is a mistake we refuse, not silently answer.
  const fingerprint = await sha256Hex(`${c.req.method} ${c.req.path}\n${await c.req.text()}`);
  const where = and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.merchantId, merchantId));
  const inserted = await db
    .insert(idempotencyKeys)
    .values({ key, merchantId, response: "", fingerprint, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const [row] = await db.select().from(idempotencyKeys).where(where);
    if (row && row.fingerprint !== "" && row.fingerprint !== fingerprint) {
      return fail(c, 422, "idempotency_key_reuse", "This Idempotency-Key was already used for a different request");
    }
    if (!row || row.response === "") {
      return fail(c, 409, "idempotency_in_progress", "A request with this Idempotency-Key is still running");
    }
    const stored = JSON.parse(row.response) as { status: 200 | 201; body: unknown };
    return c.json(stored.body as object, stored.status);
  }
  try {
    const out = await handler();
    if (out instanceof Response) {
      await db.delete(idempotencyKeys).where(where); // errors are not cached: the client may retry
      return out;
    }
    await db.update(idempotencyKeys).set({ response: JSON.stringify(out) }).where(where);
    return c.json(out.body as object, out.status);
  } catch (e) {
    await db.delete(idempotencyKeys).where(where);
    throw e;
  }
}
