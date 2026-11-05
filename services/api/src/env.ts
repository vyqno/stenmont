export type WebhookJob = { deliveryId: string };

export type Env = {
  DB: D1Database;
  WEBHOOKS: Queue<WebhookJob>;
  // public settings (wrangler vars)
  ENVIRONMENT: string;
  WHITECHAIN_RPC: string;
  WHITECHAIN_CHAIN_ID: string;
  USDT_ADDRESS: string;
  ROUTER_ADDRESS: string;
  ROUTER_DEPLOY_BLOCK: string;
  APP_URL: string;
  API_URL: string;
  INDEXER_CONFIRMATIONS?: string;
  // secrets (wrangler secret)
  RELAYER_PRIVATE_KEY: string;
};
