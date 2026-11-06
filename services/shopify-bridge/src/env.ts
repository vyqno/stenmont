export type Bindings = {
  /** KV: idempotency records, order mirror, rate-limit counters. */
  STATE: KVNamespace;
  // secrets
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_WEBHOOK_SECRET: string;
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
