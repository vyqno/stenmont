import { and, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./app";
import { invoices } from "./db/schema";
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
  let sent = 0;
  for (const inv of rows) {
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
