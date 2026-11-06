import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Migration 0020. Both tables are short-lived: pending rows live 10 minutes, connection rows 15, and expired rows are purged.

/** A merchant who has been sent to Shopify and not yet come back. Only the hash of the state is kept. */
export const shopifyOauthPending = sqliteTable(
  "shopify_oauth_pending",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    shop: text("shop").notNull(),
    stateHash: text("state_hash").notNull(),
    includeCustomers: integer("include_customers").notNull().default(0),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [uniqueIndex("shopify_oauth_pending_state_uq").on(t.stateHash), index("shopify_oauth_pending_expiry_idx").on(t.expiresAt)],
);

/** A Shopify access token, sealed (AES-GCM, bound to merchant and shop), plus the read-only preview made with it. No PII in `report`. */
export const shopifyConnections = sqliteTable(
  "shopify_connections",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    shop: text("shop").notNull(),
    sealedToken: text("sealed_token").notNull(),
    includeCustomers: integer("include_customers").notNull().default(0),
    currency: text("currency"), // the shop's currency as Shopify reported it
    report: text("report"), // JSON preview report; null when a rate is still needed
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [uniqueIndex("shopify_connections_merchant_shop_uq").on(t.merchantId, t.shop), index("shopify_connections_expiry_idx").on(t.expiresAt)],
);
