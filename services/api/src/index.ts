import { drizzle } from "drizzle-orm/d1";
import { createApp } from "./app";
import { viemChain } from "./chain";
import { handleQueue } from "./delivery";
import type { Env, WebhookJob } from "./env";
import { runIndexer } from "./indexer";
import { runReminders } from "./reminders";

export type { Env } from "./env";
export { Relayer } from "./relayer/do";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Trigger (every minute): poll the chain for PaymentRouter events; on the hour, send due-date reminders. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    ctx.waitUntil(runIndexer(env, db, viemChain(env)));
    const at = new Date(_event.scheduledTime);
    if (at.getUTCMinutes() === 0) ctx.waitUntil(runReminders(env, db, at)); // hourly
  },
  /** Queue consumer: signed webhook deliveries with retries. */
  async queue(batch: MessageBatch<WebhookJob>, env: Env) {
    await handleQueue(batch, env.DB);
  },
};
