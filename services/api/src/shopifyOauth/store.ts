import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "../app";
import { shopifyConnections, shopifyOauthPending } from "./tables";

export const PENDING_TTL_MS = 10 * 60_000;
export const CONNECTION_TTL_MS = 15 * 60_000;

/** Removes every expired row. Called whenever a connection starts or is read, and hourly by the cron, so nothing outlives its time. */
export async function purgeShopifyOauth(db: Db, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.delete(shopifyOauthPending).where(lte(shopifyOauthPending.expiresAt, at));
  await db.delete(shopifyConnections).where(lte(shopifyConnections.expiresAt, at));
}

/** A live connection of this business to this shop, or null. Does not use it up. */
export async function findConnection(db: Db, merchantId: string, shop: string, now: Date) {
  const [row] = await db
    .select()
    .from(shopifyConnections)
    .where(and(eq(shopifyConnections.merchantId, merchantId), eq(shopifyConnections.shop, shop), gt(shopifyConnections.expiresAt, now.toISOString())));
  return row ?? null;
}

/** Takes the connection out of the table in one statement, so two requests cannot both use it. */
export async function claimConnection(db: Db, merchantId: string, shop: string, now: Date) {
  const [row] = await db
    .delete(shopifyConnections)
    .where(and(eq(shopifyConnections.merchantId, merchantId), eq(shopifyConnections.shop, shop), gt(shopifyConnections.expiresAt, now.toISOString())))
    .returning();
  return row ?? null;
}
