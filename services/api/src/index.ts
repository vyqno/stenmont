import { drizzle } from "drizzle-orm/d1";
import { createApp } from "./app";
import { viemChain } from "./chain";
import { runClaimIndexer, runDefaults } from "./claims";
import { handleQueue } from "./delivery";
import type { Env, WebhookJob } from "./env";
import {RETIRED_ROUTER} from "./protocol";
import { runIndexer } from "./indexer";
import { runPreflight } from "./preflight";
import { runGasRecovery } from "./relayer/recovery";
import { runReminders } from "./reminders";
import { runRenewals } from "./renewals";
import { purgeShopifyOauth } from "./shopifyOauth/store";
import type { Address } from "viem";
import { viemEns } from "./ens/client";
import { runDirectoryRefresh } from "./ens/publishDirectory";
import { runTierBadges } from "./verification/badge";

export type { Env } from "./env";
export { Relayer } from "./relayer/do";
export { EnsSender } from "./ens/sender";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Trigger (every minute): poll the chain for PaymentRouter events; on the hour, send due-date reminders. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    const chain = viemChain(env);
    ctx.waitUntil(runGasRecovery({db,chain,now:new Date(_event.scheduledTime)}));
    ctx.waitUntil(runIndexer(env, db, chain));
    if(env.ROUTER_ADDRESS.toLowerCase()!==RETIRED_ROUTER.toLowerCase())ctx.waitUntil(runIndexer(env,db,chain.forRouter!(RETIRED_ROUTER),'v1',RETIRED_ROUTER));
    if(env.ROUTER_V2_ADDRESS&&env.INVOICE_CLAIM_V2_ADDRESS&&env.INVESTOR_REGISTRY_V2_ADDRESS&&env.REPUTATION_REGISTRY_V2_ADDRESS&&env.ROUTER_V2_DEPLOY_BLOCK&&env.INVOICE_CLAIM_V2_DEPLOY_BLOCK){
      const v2=viemChain(env,'v2');
      ctx.waitUntil(runIndexer(env,db,v2,'v2'));
      ctx.waitUntil(runClaimIndexer(env,db,v2,new Date(_event.scheduledTime),'v2'));
    }
    ctx.waitUntil(runClaimIndexer(env, db, chain));
    ctx.waitUntil(runRenewals(env, db, chain, new Date(_event.scheduledTime)));
    const at = new Date(_event.scheduledTime);
    if (at.getUTCMinutes() === 0) {
      ctx.waitUntil(runReminders(env, db, at)); // hourly
      ctx.waitUntil(runPreflight(env, db, chain, at)); // hourly: warns a day ahead of a charge the payer cannot cover
      ctx.waitUntil(runDefaults(env, db, chain, at));
      ctx.waitUntil(purgeShopifyOauth(db, at));
      ctx.waitUntil(runTierBadges({ db, ens: viemEns(env), now: at }));
      ctx.waitUntil(runDirectoryRefresh({ db, ens: viemEns(env), now: at, chainId: Number(env.WHITECHAIN_CHAIN_ID), usdt: env.USDT_ADDRESS as Address }));
    }
  },
  /** Queue consumer: signed webhook deliveries with retries. */
  async queue(batch: MessageBatch<WebhookJob>, env: Env) {
    await handleQueue(batch, env.DB);
  },
};
