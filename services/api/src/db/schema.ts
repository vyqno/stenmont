import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Money columns elsewhere are TEXT decimal strings of USDT base units; timestamps are ISO-8601 TEXT.

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ensName: text("ens_name"),
  address: text("address"), // the onchain signer (EOA or smart account) that owns this merchant's invoices
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

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(), // bytes32 hex = PaymentRouter.invoiceIdOf(merchant, ref)
    merchantId: text("merchant_id").notNull(),
    number: text("number").notNull(),
    status: text("status").notNull(), // creating | open | partially_paid | paid | cancelled | failed
    amount: text("amount").notNull(), // USDT base units
    amountPaid: text("amount_paid").notNull().default("0"),
    amountRefunded: text("amount_refunded").notNull().default("0"),
    currency: text("currency").notNull().default("USDT"),
    customerEmail: text("customer_email"),
    dueDate: text("due_date"),
    metaHash: text("meta_hash").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createTxHash: text("create_tx_hash"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("invoices_merchant_number_uq").on(t.merchantId, t.number),
    index("invoices_merchant_created_idx").on(t.merchantId, t.createdAt),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    payer: text("payer").notNull(),
    value: text("value").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: integer("block_number").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("payments_tx_log_uq").on(t.txHash, t.logIndex), index("payments_invoice_idx").on(t.invoiceId)],
);

export const paymentLinks = sqliteTable(
  "payment_links",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    slug: text("slug").notNull(),
    amount: text("amount"), // null = the customer chooses
    reusable: integer("reusable").notNull().default(0),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("payment_links_slug_uq").on(t.slug)],
);

export const webhookEndpoints = sqliteTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").notNull().default("[]"), // JSON array; empty = all events
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("webhook_endpoints_merchant_idx").on(t.merchantId)],
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull(), // pending | delivered | failed
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
  },
  (t) => [uniqueIndex("webhook_deliveries_endpoint_event_uq").on(t.endpointId, t.eventId)],
);

export const chainCursor = sqliteTable("chain_cursor", {
  name: text("name").primaryKey(),
  lastBlock: integer("last_block").notNull(),
});
