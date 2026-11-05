import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./app";
import { fail } from "./errors";
import { apiKeys, merchants } from "./db/schema";
import { sha256Hex, timingSafeEqual } from "./lib/crypto";

const KEY = /^sk_test_[0-9a-f]{32}$/;

export const requireApiKey = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!KEY.test(key)) return fail(c, 401, "unauthorized", "Missing or invalid API key");

  const db = c.var.db;
  const prefix = key.slice(8, 16);
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)));
  const hash = await sha256Hex(key);
  const match = rows.find((r) => timingSafeEqual(r.hash, hash));
  if (!match) return fail(c, 401, "unauthorized", "Missing or invalid API key");

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, match.merchantId));
  if (!merchant) return fail(c, 401, "unauthorized", "Missing or invalid API key");
  c.set("merchantId", merchant.id);
  c.set("merchant", merchant);
  await next();
});
