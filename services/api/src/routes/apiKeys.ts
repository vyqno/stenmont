import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { apiKeys } from "../db/schema";

export const apiKeyRoutes = new Hono<AppEnv>();

/** What the settings screen shows: the start of each key so it can be recognised. The key itself is shown only once, at creation. */
apiKeyRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(apiKeys).where(eq(apiKeys.merchantId, c.var.merchantId)).orderBy(desc(apiKeys.createdAt));
  return c.json({ data: rows.map((k) => ({ id: k.id, display: `sk_test_${k.prefix}…`, createdAt: k.createdAt, revoked: k.revokedAt !== null })) });
});
