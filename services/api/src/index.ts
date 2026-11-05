import { drizzle } from "drizzle-orm/d1";
import { createApp } from "./app";
import { viemChain } from "./chain";
import { handleQueue } from "./delivery";
import type { Env, WebhookJob } from "./env";
import { runIndexer } from "./indexer";

export type { Env } from "./env";
export { Relayer } from "./relayer/do";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Trigger: poll the chain for PaymentRouter events. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runIndexer(env, drizzle(env.DB), viemChain(env)));
  },
  /** Queue consumer: signed webhook deliveries with retries. */
  async queue(batch: MessageBatch<WebhookJob>, env: Env) {
    await handleQueue(batch, env.DB);
  },
};
