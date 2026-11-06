export type WebhookJob = { deliveryId: string };

import type { EnsSender } from "./ens/sender";
import type { Relayer } from "./relayer/do";

export type Env = {
  DB: D1Database;
  AGENT_ENABLED?: string;
  GEMINI_API_KEY?: string;
  AGENT_KEY_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EMAIL_CODE_SECRET?: string;
  EMAIL_MODE?: string;
  EMAIL?: import("./email/transactional").MailEnv["EMAIL"];
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
  INVESTOR_REGISTRY_ADDRESS: string;
  INVOICE_CLAIM_ADDRESS: string;
  REPUTATION_REGISTRY_ADDRESS: string;
  /** Parent domain for the session cookie, so the app and the API (sibling subdomains) share it. Unset = host-only. */
  COOKIE_DOMAIN?: string;
  INDEXER_CONFIRMATIONS?: string;
  // World (secrets are optional so the API runs without them; the World routes answer 503 when they are missing)
  WORLD_APP_ID?: string;
  WORLD_RP_ID?: string;
  WORLD_RP_SIGNING_KEY?: string;
  WORLD_OIDC_CLIENT_ID?: string;
  WORLD_OIDC_CLIENT_SECRET?: string;
  /** "staging" or "production": proofs from any other environment are refused. */
  WORLD_ENVIRONMENT?: string;
  WORLD_OIDC_ISSUER?: string;
  WORLD_VERIFY_URL?: string;
  /** Refunds above this many USDT base units need a World approval. Must equal the router's `refundApprovalThreshold`. Default 100 USDT. */
  REFUND_APPROVAL_THRESHOLD?: string;
  // secrets (wrangler secret)
  RELAYER_PRIVATE_KEY: string;
  /** Signs the router's large-refund approvals once a person has approved (the router's `attester`). */
  ATTESTER_PRIVATE_KEY?: string;
  /** The wallet that issues subnames. It may only register names on the subname registry. */
  ENS_REGISTRAR_PRIVATE_KEY: string;
  /** Staging only: the wallet that hands out test USDT. Never set in production. */
  FAUCET_PRIVATE_KEY?: string;
  /** Test environments: claims per IP per day (default 5). */
  FAUCET_IP_LIMIT?: string;
  /** The Shopify app that merchants install to connect their store (read-only import). Both missing = the connect routes answer 503. */
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  /** Signs the sandbox KYC provider's webhooks. Test environments only: the sandbox provider is off in production and without this. */
  KYC_MOCK_WEBHOOK_SECRET?: string;
  /** "yes" = allowlisting an investor needs tier 4 (documents). Leave unset in test environments so a World-verified person can be allowed. */
  INVESTOR_REQUIRES_KYC?: string;
  /** Signs customers' receipts links (at least 32 characters). Without it there are no links and the account routes answer 503. */
  ACCOUNT_LINK_SECRET?: string;
  /** Test environments: business sign-ups (activations) per IP per hour (default 5). Each costs the platform gas. */
  ACTIVATE_IP_LIMIT?: string;
};
