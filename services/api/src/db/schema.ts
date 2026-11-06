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
    fingerprint: text("fingerprint").notNull().default(""), // what the key was first used for: method, path and body
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
    status: text("status").notNull(), // creating | open | partially_paid | paid | cancelled | failed | expired
    amount: text("amount").notNull(), // USDT base units
    amountPaid: text("amount_paid").notNull().default("0"),
    amountRefunded: text("amount_refunded").notNull().default("0"),
    currency: text("currency").notNull().default("USDT"),
    customerEmail: text("customer_email"),
    dueDate: text("due_date"),
    metaHash: text("meta_hash").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    taxRateBps: integer("tax_rate_bps"), // optional tax label, basis points of the tax-inclusive total; display and export only
    taxLabel: text("tax_label"),
    payeeName: text("payee_name"), // the ENS name the payee was resolved from, shown on the pay page
    buyerMerchantId: text("buyer_merchant_id"), // set when the buyer is also a Stenmont business (checked against the supplier for the same human)
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
  requiresAttester: integer("requires_attester").notNull().default(0), // a person approved this large refund; the router also needs the attester signature
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

export const ensNames = sqliteTable(
  "ens_names",
  {
    merchantId: text("merchant_id").primaryKey(), // one name per business
    label: text("label").notNull(),
    name: text("name").notNull(),
    resolver: text("resolver").notNull(), // the name's own resolver (permissions are per key, so each name needs its own)
    agentRegistry: text("agent_registry").notNull(), // the registry that holds the business's agent names
    payoutLocked: integer("payout_locked").notNull().default(0),
    status: text("status").notNull(), // claiming | active
    txHashes: text("tx_hashes").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ens_names_label_uq").on(t.label)],
);

export const worldEnrollments = sqliteTable(
  "world_enrollments",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    action: text("action").notNull(),
    nullifier: text("nullifier").notNull(), // decimal text of the 256-bit number
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [uniqueIndex("world_enrollments_action_nullifier").on(t.action, t.nullifier), uniqueIndex("world_enrollments_merchant_action").on(t.merchantId, t.action)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    operation: text("operation").notNull(), // refund | payout_change | agent_limit
    paramsHash: text("params_hash").notNull(),
    nonce: text("nonce").notNull(),
    status: text("status").notNull(), // pending | approved | denied | consumed
    worldSub: text("world_sub"),
    authTime: integer("auth_time"),
    denyReason: text("deny_reason"),
    pkceVerifier: text("pkce_verifier"), // the secret half of the sign-in code challenge; never sent to the browser
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("approvals_lookup").on(t.merchantId, t.operation, t.createdAt)],
);

export const ensAgents = sqliteTable(
  "ens_agents",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    label: text("label").notNull(),
    name: text("name").notNull(), // billing-bot.acme.stenmont.eth
    agentAddress: text("agent_address").notNull(),
    resolver: text("resolver").notNull(), // the agent's own resolver
    scopes: text("scopes").notNull().default("[]"),
    dailyLimit: text("daily_limit").notNull(), // USDT base units
    perTxLimit: text("per_tx_limit").notNull(),
    expiresAt: text("expires_at").notNull(),
    status: text("status").notNull(), // creating | active | revoked
    txHashes: text("tx_hashes").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ens_agents_merchant_label_uq").on(t.merchantId, t.label)],
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

// ---- financing (sell an invoice) --------------------------------------------------------------------------------------

/**
 * One row per offer to sell an invoice, mirrored from InvoiceClaim. `pending` rows are requests waiting for the merchant's
 * two passkey signatures; from `sending` on, at most one row per invoice is live.
 */
export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(), // cl_...: the listing id
    invoiceId: text("invoice_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    status: text("status").notNull(), // pending | sending | listed | funding | funded | settled | defaulted | cancelled
    discountBps: integer("discount_bps").notNull(),
    reserveBps: integer("reserve_bps").notNull(),
    face: text("face").notNull(), // USDT base units
    price: text("price").notNull(),
    reserve: text("reserve").notNull(),
    dueDate: integer("due_date").notNull(), // unix seconds
    deadline: integer("deadline").notNull(), // unix seconds: signed into the terms and the hook; also the last moment to fund
    termsChallenge: text("terms_challenge").notNull(), // base64url of the ClaimTerms digest
    hookChallenge: text("hook_challenge").notNull(), // base64url of the router SetHook digest
    expiresAt: integer("expires_at").notNull(), // unix seconds: how long the merchant has to sign
    investor: text("investor"),
    listTxHash: text("list_tx_hash"),
    fundTxHash: text("fund_tx_hash"),
    closeTxHash: text("close_tx_hash"), // settle or default
    leaseUntil: integer("lease_until"), // default job: unix seconds until which one run owns this claim
    showInvoiceNumber: integer("show_invoice_number").notNull().default(0), // 1 = the public certificate may show the invoice number (merchant's choice)
    listedAt: text("listed_at"), // when each step happened, for the merchant's timeline and the public certificate
    fundedAt: text("funded_at"),
    closedAt: text("closed_at"), // settle or default
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("claims_invoice_idx").on(t.invoiceId), index("claims_status_idx").on(t.status)],
);

/** One person, one investor address: the unique (action, nullifier) is what stops a replayed World proof. */
export const investorEnrollments = sqliteTable(
  "investor_enrollments",
  {
    address: text("address").primaryKey(), // lower-case investor account
    action: text("action").notNull(),
    nullifier: text("nullifier").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [uniqueIndex("investor_enrollments_action_nullifier").on(t.action, t.nullifier)],
);

/** A website a business has told us about, and the token it must publish in DNS to prove the name is theirs. */
export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    url: text("url").notNull(),
    host: text("host").notNull(),
    platform: text("platform"), // what the business says it runs; a label for the dashboard only
    token: text("token").notNull(), // published as `stenmont-verify=<token>` at `_stenmont.<host>`
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("sites_merchant_host_uq").on(t.merchantId, t.host)],
);

/** The latest result of each check for a site: reachable | domain | webhook | payment. */
export const siteChecks = sqliteTable(
  "site_checks",
  {
    siteId: text("site_id").notNull(),
    kind: text("kind").notNull(),
    ok: integer("ok").notNull(),
    detail: text("detail").notNull(),
    checkedAt: text("checked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.kind] })],
);

/** Per business: the live/paused switch, and a test/live label (a stored field only; there is one network). */
export const paymentSwitch = sqliteTable("payment_switch", {
  merchantId: text("merchant_id").primaryKey(),
  paused: integer("paused").notNull().default(0),
  mode: text("mode").notNull().default("test"),
  updatedAt: text("updated_at").notNull(),
});
// ---------------------------------------------------------------------------------------------------------------------
// Store catalogue (migration 0019). Prices are USDT base units as TEXT, like everywhere else. Every table carries merchant_id
// and every query filters on it. `external_source` + `external_id` make imports idempotent (re-running updates, never duplicates).

export const storeSettings = sqliteTable(
  "store_settings",
  {
    merchantId: text("merchant_id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    displayNote: text("display_note").notNull().default(""), // optional line shown under prices, e.g. a local-currency hint
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("store_settings_slug_uq").on(t.slug)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    descriptionHtml: text("description_html").notNull().default(""), // already sanitised
    vendor: text("vendor").notNull().default(""),
    productType: text("product_type").notNull().default(""),
    status: text("status").notNull().default("draft"), // draft | active | archived
    tags: text("tags").notNull().default("[]"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("products_merchant_handle_uq").on(t.merchantId, t.handle),
    uniqueIndex("products_external_uq").on(t.merchantId, t.externalSource, t.externalId),
  ],
);

export const variants = sqliteTable(
  "variants",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull().default(""),
    sku: text("sku").notNull().default(""),
    price: text("price").notNull(), // USDT base units
    inventory: integer("inventory").notNull().default(0),
    trackInventory: integer("track_inventory").notNull().default(1), // 0 = always in stock
    options: text("options").notNull().default("{}"),
    position: integer("position").notNull().default(1),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    uniqueIndex("variants_external_uq").on(t.merchantId, t.externalSource, t.externalId),
  ],
);

export const productImages = sqliteTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    productId: text("product_id").notNull(),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(1),
  },
  (t) => [uniqueIndex("product_images_uq").on(t.productId, t.url)],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("collections_merchant_handle_uq").on(t.merchantId, t.handle)],
);

export const productCollections = sqliteTable(
  "product_collections",
  { productId: text("product_id").notNull(), collectionId: text("collection_id").notNull() },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] })],
);

/** Records only: the minimum fields from a migration, never passwords or addresses. */
export const importedCustomers = sqliteTable(
  "imported_customers",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    externalSource: text("external_source").notNull(),
    externalId: text("external_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    country: text("country").notNull().default(""),
    acceptsMarketing: integer("accepts_marketing").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("imported_customers_external_uq").on(t.merchantId, t.externalSource, t.externalId)],
);

export const importedOrders = sqliteTable(
  "imported_orders",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    externalSource: text("external_source").notNull(),
    externalId: text("external_id").notNull(),
    email: text("email").notNull().default(""),
    financialStatus: text("financial_status").notNull().default(""),
    fulfillmentStatus: text("fulfillment_status").notNull().default(""),
    currency: text("currency").notNull().default(""),
    total: text("total").notNull().default("0"), // in the ORIGINAL currency, as the source stated it (a record, not a Stenmont payment)
    lineCount: integer("line_count").notNull().default(0),
    orderedAt: text("ordered_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("imported_orders_external_uq").on(t.merchantId, t.externalSource, t.externalId)],
);

/** A checkout in progress: stock is held until `reservedUntil`, then released unless the invoice was paid. */
export const storeOrders = sqliteTable(
  "store_orders",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    invoiceId: text("invoice_id"),
    status: text("status").notNull(), // reserved | paid | released | failed
    lines: text("lines").notNull(), // JSON: [{ variantId, quantity, unitPrice }] as priced by the server
    total: text("total").notNull(),
    reservedUntil: text("reserved_until").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("store_orders_merchant_idx").on(t.merchantId, t.status)],
);

// ---- verification tiers -------------------------------------------------------------------------------------------
// Only a provider's reference and its decision are kept: never documents or personal details.

export const verificationRecords = sqliteTable(
  "verification_records",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    tier: integer("tier").notNull(),
    method: text("method").notNull(), // email | domain | world | kyc
    provider: text("provider"),
    reference: text("reference"),
    decision: text("decision").notNull(), // approved | rejected | pending
    decidedAt: text("decided_at").notNull(),
    expiresAt: text("expires_at"),
  },
  (t) => [index("verification_records_merchant").on(t.merchantId, t.method), uniqueIndex("verification_records_provider_ref").on(t.provider, t.reference)],
);

/** Optional per-tier overrides of the demo defaults in `verification/tiers.ts`. Money is USDT base units as TEXT. */
export const verificationLimits = sqliteTable("verification_limits", {
  tier: integer("tier").primaryKey(),
  perInvoice: text("per_invoice").notNull(),
  dailyVolume: text("daily_volume").notNull(),
  financingCap: text("financing_cap").notNull(),
  investor: integer("investor").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const kycWebhookEvents = sqliteTable(
  "kyc_webhook_events",
  { provider: text("provider").notNull(), eventId: text("event_id").notNull(), receivedAt: text("received_at").notNull() },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

/** A wallet that may sign in to a business (EIP-4361). One wallet, one business. */
export const walletLogins = sqliteTable(
  "wallet_logins",
  { address: text("address").primaryKey(), merchantId: text("merchant_id").notNull(), createdAt: text("created_at").notNull() },
  (t) => [index("wallet_logins_merchant").on(t.merchantId)],
);

export const siweNonces = sqliteTable("siwe_nonces", {
  nonce: text("nonce").primaryKey(),
  merchantId: text("merchant_id"),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

/** The tier last published to the business's ENS name. */
export const tierBadges = sqliteTable("tier_badges", {
  merchantId: text("merchant_id").primaryKey(),
  publishedTier: integer("published_tier").notNull(),
  txHash: text("tx_hash"),
  publishedAt: text("published_at").notNull(),
});

/**
 * What a business told us for its ENS pay directory (see docs/ENS_DIRECTORY.md) and what we last wrote to its name.
 * A row exists once the business has published; the hourly job then keeps the derived records (token, cap) current.
 */
export const ensDirectory = sqliteTable("ens_directory", {
  merchantId: text("merchant_id").primaryKey(),
  payUrl: text("pay_url"),
  x402Url: text("x402_url"),
  refund: text("refund"),
  published: text("published").notNull().default("{}"), // JSON: the directory records as last written to ENS
  txHash: text("tx_hash"),
  publishedAt: text("published_at"),
  updatedAt: text("updated_at").notNull(),
});
