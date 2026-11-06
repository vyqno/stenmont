export type Bindings = {
  /** KV: idempotency records, order mirror, rate-limit counters. */
  STATE: KVNamespace;
  // secrets
  /** The Dev Dashboard app's client id and secret: the bridge gets a 24-hour Admin token from them. */
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  /** Optional override: a legacy static Admin token. When set, no token is fetched. */
  SHOPIFY_ADMIN_TOKEN?: string;
  /** Optional: defaults to SHOPIFY_CLIENT_SECRET, which is what Shopify signs webhooks with. */
  SHOPIFY_WEBHOOK_SECRET?: string;
  STENMONT_API_KEY: string;
  STENMONT_WEBHOOK_SECRET: string;
  BRIDGE_ADMIN_TOKEN: string;
  // plain vars
  SHOPIFY_SHOP_DOMAIN: string;
  STENMONT_API_URL: string;
  SHOP_URL: string;
  ALLOWED_ORIGINS: string;
  RATE_PER_USD?: string;
};

/** Things tests replace: the network, the clock and sleeping. */
export type Deps = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number };

export type AppEnv = { Bindings: Bindings; Variables: { deps: Deps } };
