import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Money columns elsewhere are TEXT decimal strings of USDT base units; timestamps are ISO-8601 TEXT.

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ensName: text("ens_name"),
  address: text("address"), // the onchain signer (EOA or smart account) that owns this merchant's invoices
  payoutAddress: text("payout_address"),
  status: text("status").notNull().default("active"), // pending (signed up, account not yet activated) | active
  createdAt: text("created_at").notNull(),
});

export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(), // WebAuthn credential id, base64url
  merchantId: text("merchant_id").notNull(),
  qx: text("qx").notNull(),
  qy: text("qy").notNull(),
  counter: integer("counter").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // register | activate | login
  challenge: text("challenge").notNull(), // base64url of the exact bytes the passkey must sign
  merchantId: text("merchant_id"),
  data: text("data").notNull().default("{}"),
  expiresAt: text("expires_at").notNull(),
  claimedAt: text("claimed_at"), // short lock while a request is working on it
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(), // sha256 of the cookie value; the cookie itself is never stored
  merchantId: text("merchant_id").notNull(),
  passkeyId: text("passkey_id").notNull(),
  expiresAt: text("expires_at").notNull(),
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
    successUrl: text("success_url"), // where the pay page sends the customer after paying (set by the merchant, never by the payer)
    cancelUrl: text("cancel_url"),
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

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    toAddress: text("to_address").notNull(),
    value: text("value").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: integer("block_number").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("refunds_tx_log_uq").on(t.txHash, t.logIndex), index("refunds_invoice_idx").on(t.invoiceId)],
);

export const refundRequests = sqliteTable("refund_requests", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull(),
  invoiceId: text("invoice_id").notNull(),
  toAddress: text("to_address").notNull(),
  value: text("value").notNull(),
  salt: text("salt").notNull(),
  validBefore: integer("valid_before").notNull(), // unix seconds
  challenge: text("challenge").notNull(), // base64url of the digest the merchant passkey signs
  status: text("status").notNull().default("pending"), // pending | sending | submitted
  txHash: text("tx_hash"),
  createdAt: text("created_at").notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(), // bytes32 hex, the id used onchain
  merchantId: text("merchant_id").notNull(),
  amount: text("amount").notNull(), // USDT base units per period
  periodSeconds: integer("period_seconds").notNull(),
  maxCharges: integer("max_charges").notNull(),
  startAt: integer("start_at").notNull(), // unix seconds, when the first charge is due
  customerEmail: text("customer_email"),
  payer: text("payer"),
  status: text("status").notNull(), // offered | subscribing | active | past_due | cancelled | completed
  charges: integer("charges").notNull().default(0),
  nextChargeAt: integer("next_charge_at").notNull(), // mirror of the contract's schedule, refreshed after every charge
  failedAttempts: integer("failed_attempts").notNull().default(0),
  retryAt: integer("retry_at"),
  subscribeTx: text("subscribe_tx"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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

// ---- relayer ---------------------------------------------------------------------------------------------------
// Amounts are TEXT (wei or USDT base units) and converted to bigint in code. Gas tank rows carry a version so
// concurrent updates are optimistic: UPDATE ... WHERE version = ?.

export const relayerTxs = sqliteTable(
  "relayer_txs",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(), // 'platform' for faucet transfers
    invoiceId: text("invoice_id"),
    kind: text("kind").notNull(), // pay | deploy_pay | create_invoice | faucet
    payer: text("payer"),
    value: text("value"),
    txHash: text("tx_hash"),
    status: text("status").notNull(), // pending | sent | success | reverted | rejected
    error: text("error"),
    gasUsed: text("gas_used"),
    wbtCost: text("wbt_cost"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("relayer_txs_idem_uq").on(t.idempotencyKey), index("relayer_txs_merchant_idx").on(t.merchantId, t.createdAt)],
);

export const gasTanks = sqliteTable("gas_tanks", {
  merchantId: text("merchant_id").primaryKey(),
  wbtBalance: text("wbt_balance").notNull().default("0"), // wei the merchant has put up for gas
  dailyCapWbt: text("daily_cap_wbt").notNull(), // most the relayer may spend for this merchant per UTC day
  spentTodayWbt: text("spent_today_wbt").notNull().default("0"),
  spentDay: text("spent_day").notNull(), // UTC date the spent amount belongs to
  perPayerDailyCapUsdt: text("per_payer_daily_cap_usdt").notNull(),
  version: integer("version").notNull().default(0),
});

export const payerUsage = sqliteTable(
  "payer_usage",
  {
    merchantId: text("merchant_id").notNull(),
    payer: text("payer").notNull(),
    day: text("day").notNull(),
    usdt: text("usdt").notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.merchantId, t.payer, t.day] })],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    bucket: integer("bucket").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.bucket] })],
);
