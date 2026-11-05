import { and, eq } from "drizzle-orm";
import type { Db } from "./app";
import { webhookDeliveries, webhookEndpoints } from "./db/schema";
import type { WebhookJob } from "./env";
import type { EventType } from "./events";

export type WebhookEvent = { id: string; type: EventType; data: unknown };

/**
 * Fan an event out to every active endpoint of the merchant that subscribes to it.
 * One delivery row per (endpoint, event id): emitting the same event twice never double-sends.
 */
export async function emitEvent(
  db: Db,
  queue: { send(message: WebhookJob): Promise<unknown> },
  merchantId: string,
  event: WebhookEvent,
): Promise<number> {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.active, 1)));
  let queued = 0;
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    created: Math.floor(Date.now() / 1000),
    data: event.data,
    livemode: false,
  });
  for (const ep of endpoints) {
    const subscribed = JSON.parse(ep.events) as string[];
    if (subscribed.length > 0 && !subscribed.includes(event.type)) continue;
    const inserted = await db
      .insert(webhookDeliveries)
      .values({
        id: crypto.randomUUID(),
        endpointId: ep.id,
        merchantId,
        eventId: event.id,
        type: event.type,
        payload,
        status: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    const row = inserted[0];
    if (row) {
      await queue.send({ deliveryId: row.id });
      queued++;
    }
  }
  return queued;
}
