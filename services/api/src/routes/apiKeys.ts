import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { apiKeys } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { randomHex, sha256Hex } from "../lib/crypto";

export const apiKeyRoutes = new Hono<AppEnv>();

/** What the settings screen shows: the start of each key so it can be recognised. The key itself is shown only once, at creation. */
apiKeyRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(apiKeys).where(eq(apiKeys.merchantId, c.var.merchantId)).orderBy(desc(apiKeys.createdAt));
  return c.json({ data: rows.map((k) => ({ id: k.id, display: `sk_test_${k.prefix}…`, createdAt: k.createdAt, revoked: k.revokedAt !== null })) });
});

/** Makes another key. It is returned here once and never again. */
apiKeyRoutes.post("/", async (c) =>
  runIdempotent(c, c.var.merchantId, async () => {
    const key = `sk_test_${randomHex(16)}`;
    const id = `k_${randomHex(8)}`;
    const now = c.var.now().toISOString();
    await c.var.db.insert(apiKeys).values({ id, merchantId: c.var.merchantId, prefix: key.slice(8, 16), hash: await sha256Hex(key), scopes: "*", createdAt: now });
    await audit(c.var.db, { merchantId: c.var.merchantId, actor: `merchant:${c.var.merchantId}`, action: "api_key.created", payload: { id } });
    return { status: 201 as const, body: { id, key, display: `sk_test_${key.slice(8, 16)}…`, createdAt: now } };
  }),
);

/** Stops a key working at once. The last working key cannot be revoked, so a business never locks itself out of the API. */
apiKeyRoutes.post("/:id/revoke", async (c) =>
  runIdempotent(c, c.var.merchantId, async () => {
    const { db, merchantId } = c.var;
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.merchantId, merchantId)));
    if (!key) return fail(c, 404, "not_found", "Key not found");
    if (key.revokedAt) return fail(c, 409, "already_revoked", "This key is already revoked");
    const active = await db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.merchantId, merchantId), isNull(apiKeys.revokedAt)));
    if (active.length <= 1) return fail(c, 409, "last_key", "This is your only working key. Make a new one first.");
    await db.update(apiKeys).set({ revokedAt: c.var.now().toISOString() }).where(eq(apiKeys.id, key.id));
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "api_key.revoked", payload: { id: key.id } });
    return { status: 200 as const, body: { id: key.id, revoked: true } };
  }),
);
