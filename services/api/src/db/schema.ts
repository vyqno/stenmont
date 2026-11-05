import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Money columns elsewhere are TEXT decimal strings of USDT base units; timestamps are ISO-8601 TEXT.

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ensName: text("ens_name"),
  payoutAddress: text("payout_address"),
  createdAt: text("created_at").notNull(),
});

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("api_keys_prefix_idx").on(t.prefix)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  merchantId: text("merchant_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    merchantId: text("merchant_id").notNull(),
    response: text("response").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.merchantId] })],
);
