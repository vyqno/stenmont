export type WebhookJob = { deliveryId: string };

import type { Relayer } from "./relayer/do";

export type Env = {
  DB: D1Database;
  WEBHOOKS: Queue<WebhookJob>;
  RELAYER: DurableObjectNamespace<Relayer>;
  // public settings (wrangler vars)
  ENVIRONMENT: string;
  WHITECHAIN_RPC: string;
  WHITECHAIN_CHAIN_ID: string;
  USDT_ADDRESS: string;
  ROUTER_ADDRESS: string;
  ROUTER_DEPLOY_BLOCK: string;
  APP_URL: string;
  API_URL: string;
  FACTORY_ADDRESS: string;
  /** Parent domain for the session cookie, so the app and the API (sibling subdomains) share it. Unset = host-only. */
  COOKIE_DOMAIN?: string;
  INDEXER_CONFIRMATIONS?: string;
  // secrets (wrangler secret)
  RELAYER_PRIVATE_KEY: string;
  /** Staging only: the wallet that hands out test USDT. Never set in production. */
  FAUCET_PRIVATE_KEY?: string;
};
