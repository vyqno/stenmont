export type WebhookJob = { deliveryId: string };

import type { EnsSender } from "./ens/sender";
import type { Relayer } from "./relayer/do";

export type Env = {
  DB: D1Database;
  WEBHOOKS: Queue<WebhookJob>;
  RELAYER: DurableObjectNamespace<Relayer>;
  /** Serialises the ENS registrar wallet's transactions on Sepolia. */
  ENS_SENDER: DurableObjectNamespace<EnsSender>;
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
  SEPOLIA_RPC: string;
  /** Where ENS transactions are sent (a gateway that accepts raw transactions); reads use SEPOLIA_RPC. */
  ENS_SEND_RPC?: string;
  ENS_ROOT_NAME: string;
  /** The UserRegistry that holds the subnames of ENS_ROOT_NAME. */
  ENS_SUBNAME_REGISTRY: string;
  SUBSCRIPTION_MANAGER_ADDRESS: string;
  /** Parent domain for the session cookie, so the app and the API (sibling subdomains) share it. Unset = host-only. */
  COOKIE_DOMAIN?: string;
  INDEXER_CONFIRMATIONS?: string;
  // secrets (wrangler secret)
  RELAYER_PRIVATE_KEY: string;
  /** The wallet that issues subnames. It may only register names on the subname registry. */
  ENS_REGISTRAR_PRIVATE_KEY: string;
  /** Staging only: the wallet that hands out test USDT. Never set in production. */
  FAUCET_PRIVATE_KEY?: string;
  /** Test environments: claims per IP per day (default 5). */
  FAUCET_IP_LIMIT?: string;
  /** Test environments: business sign-ups (activations) per IP per hour (default 5). Each costs the platform gas. */
  ACTIVATE_IP_LIMIT?: string;
};
