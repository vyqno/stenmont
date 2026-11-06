import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./app";
import { invoices, subscriptions } from "./db/schema";
import type { Env } from "./env";
import { invoiceView } from "./lib/views";
import { emitEvent } from "./webhooks";

const DAY = 86_400_000;
const WINDOW = 3 * DAY;
export type Reminder = "due_soon" | "due" | "overdue";

/** 3 days before the due date, from the due date to 3 days after, and after that. */
export function stageOf(dueMs: number, nowMs: number): Reminder | null {
  if (nowMs >= dueMs + WINDOW) return "overdue";
  if (nowMs >= dueMs) return "due";
  if (nowMs >= dueMs - WINDOW) return "due_soon";
  return null;
}

/**
 * Tells each merchant's system (a signed `invoice.reminder` webhook) which unpaid invoices need a nudge, so it can email
 * the customer. One event per invoice per stage: the event id is fixed, so running this again never repeats a reminder.
 */
export async function runReminders(env: Env, db: Db, now: Date): Promise<{ sent: number }> {
  const horizon = new Date(now.getTime() + WINDOW).toISOString();
  const rows = await db
    .select()
    .from(invoices)
    .where(and(inArray(invoices.status, ["open", "partially_paid"]), isNotNull(invoices.dueDate), lt(invoices.dueDate, horizon)));
  // An invoice the buyer is paying in parts (or has finished paying that way) is not chased.
  const onPlan = new Set(
    (await db.select({ id: subscriptions.invoiceId }).from(subscriptions).where(and(eq(subscriptions.kind, "instalment"), inArray(subscriptions.status, ["active", "completed"])))).map((r) => r.id),
  );
  let sent = 0;
  for (const inv of rows) {
    if (onPlan.has(inv.id)) continue;
    const stage = stageOf(Date.parse(inv.dueDate!), now.getTime());
    if (!stage) continue;
    const queued = await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
      id: `evt_reminder_${inv.id}_${stage}`,
      type: "invoice.reminder",
      data: { invoice: invoiceView(inv, env), reminder: stage },
    });
    if (queued > 0) sent++;
  }
  return { sent };
}
