import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Db } from "./app";
import { webhookDeliveries, webhookEndpoints } from "./db/schema";
import type { WebhookJob } from "./env";
import { signWebhook } from "./lib/signature";

export const MAX_ATTEMPTS = 10;
const backoffSeconds = (attempt: number) => Math.min(10 * 2 ** attempt, 3600); // 20s, 40s, 80s ... capped at 1h

export type DeliveryOutcome =
  | { outcome: "delivered" }
  | { outcome: "retry"; delaySeconds: number }
  | { outcome: "failed" }
  | { outcome: "skipped" };

/** One delivery attempt. Safe to call twice for the same delivery: a finished delivery is skipped. */
export async function deliver(
  db: Db,
  deliveryId: string,
  fetchFn: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<DeliveryOutcome> {
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
  if (!d || d.status !== "pending") return { outcome: "skipped" };

  const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId));
  if (!ep || ep.active !== 1) {
    await db.update(webhookDeliveries).set({ status: "failed", lastError: "endpoint inactive" }).where(eq(webhookDeliveries.id, d.id));
    return { outcome: "failed" };
  }

  const attempts = d.attempts + 1;
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetchFn(ep.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Stenmont-Webhooks/1",
        "stenmont-signature": await signWebhook(ep.secret, d.payload, Math.floor(nowMs() / 1000)),
        "stenmont-event-id": d.eventId,
      },
      body: d.payload,
    });
    responseStatus = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!error) {
    await db
      .update(webhookDeliveries)
      .set({ status: "delivered", attempts, responseStatus, lastError: null, deliveredAt: new Date(nowMs()).toISOString() })
      .where(eq(webhookDeliveries.id, d.id));
    return { outcome: "delivered" };
  }
  if (attempts >= MAX_ATTEMPTS) {
    await db.update(webhookDeliveries).set({ status: "failed", attempts, responseStatus, lastError: error }).where(eq(webhookDeliveries.id, d.id));
    return { outcome: "failed" };
  }
  await db.update(webhookDeliveries).set({ attempts, responseStatus, lastError: error }).where(eq(webhookDeliveries.id, d.id));
  return { outcome: "retry", delaySeconds: backoffSeconds(attempts) };
}

/** Queue consumer. At-least-once: duplicates are harmless because `deliver` skips finished deliveries. */
export async function handleQueue(
  batch: MessageBatch<WebhookJob>,
  d1: D1Database,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const db = drizzle(d1);
  for (const msg of batch.messages) {
    try {
      const r = await deliver(db, msg.body.deliveryId, fetchFn);
      if (r.outcome === "retry") msg.retry({ delaySeconds: r.delaySeconds });
      else msg.ack();
    } catch (e) {
      console.error("delivery crashed", e);
      msg.retry({ delaySeconds: 30 });
    }
  }
}
