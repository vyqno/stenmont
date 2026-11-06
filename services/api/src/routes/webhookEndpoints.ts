import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { webhookEndpoints } from "../db/schema";
import { EVENT_TYPES } from "../events";
import { fail } from "../errors";
import { runIdempotent, type IdempotentResult } from "../idempotency";
import { randomHex } from "../lib/crypto";
import { invalid, isPublicHttpsUrl } from "../lib/validation";

const createSchema = z.strictObject({
  url: z.string().max(2048).refine(isPublicHttpsUrl, "must be a public https URL"),
  events: z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length).default([]),
});

type Row = typeof webhookEndpoints.$inferSelect;
const view = (r: Row) => ({ id: r.id, url: r.url, events: JSON.parse(r.events) as string[], active: r.active === 1, createdAt: r.createdAt });

export const webhookEndpointRoutes = new Hono<AppEnv>();

webhookEndpointRoutes.post("/", async (c) => {
  const create = async (): Promise<IdempotentResult | Response> => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const { db, merchantId } = c.var;
    const existing = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.merchantId, merchantId));
    if (existing.length >= 10) return fail(c, 409, "too_many_endpoints", "A business can have at most 10 webhook endpoints.");
    const id = crypto.randomUUID();
    const secret = `whsec_${randomHex(24)}`;
    await db.insert(webhookEndpoints).values({
      id,
      merchantId,
      url: parsed.data.url,
      secret,
      events: JSON.stringify(parsed.data.events),
      createdAt: new Date().toISOString(),
    });
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "webhook_endpoint.created", payload: { id, url: parsed.data.url } });
    const [row] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    // A saved key replays this same logical creation response; GET never exposes it.
    return { status: 201, body: { ...view(row!), secret } };
  };
  // Existing clients without a key keep their one-shot creation behavior.
  if (c.req.header("idempotency-key") !== undefined) return runIdempotent(c, c.var.merchantId, create);
  const out = await create();
  return out instanceof Response ? out : c.json(out.body as object, out.status);
});

webhookEndpointRoutes.get("/", async (c) => {
  const rows = await c.var.db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, c.var.merchantId), eq(webhookEndpoints.active, 1)))
    .orderBy(desc(webhookEndpoints.createdAt));
  return c.json({ data: rows.map(view) });
});

webhookEndpointRoutes.delete("/:id", async (c) => {
  const { db, merchantId } = c.var;
  const hit = await db
    .update(webhookEndpoints)
    .set({ active: 0 })
    .where(and(eq(webhookEndpoints.id, c.req.param("id")), eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.active, 1)))
    .returning({ id: webhookEndpoints.id });
  if (hit.length === 0) return fail(c, 404, "not_found", "Endpoint not found");
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "webhook_endpoint.deleted", payload: { id: hit[0]!.id } });
  return c.body(null, 204);
});
