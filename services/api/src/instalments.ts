import type { EventType } from "./events";
import { randomHex } from "./lib/crypto";
import type { Db } from "./app";
import { invoices, subscriptions } from "./db/schema";

export const DEFAULT_PERIOD_SECONDS = 30 * 86_400;
/** Most parts a plan may have. The invoice option allows 2 or 3; the collections agent's policy may allow more. */
export const MAX_PARTS = 12;

/**
 * The contract charges the same amount each time, so a plan is `each` x `count`. What does not divide evenly (at most
 * `count - 1` base units, never more than a few millionths of a dollar) is `rounding`: it is not charged. The plan can
 * therefore never take more than the invoice total.
 */
export function splitInstalments(total: bigint, count: number): { each: bigint; rounding: bigint } {
  const n = BigInt(count);
  return { each: total / n, rounding: total % n };
}

/** `subscription.charged` for a normal subscription, `instalment.charged` for a plan. */
export const eventType = (kind: string, what: "started" | "created" | "cancelled"): EventType => (kind === "instalment" ? (what === "created" ? "instalment.started" : `instalment.${what}`) : what === "started" ? "subscription.created" : `subscription.${what}`) as EventType;

type Invoice = typeof invoices.$inferSelect;
type Created = { ok: true; row: typeof subscriptions.$inferSelect } | { ok: false; code: "too_small" };

/** Makes the offer for one invoice: the buyer agrees once, then the cron charges each part. Saves nothing else. */
export async function createInstalmentPlan(
  db: Db,
  now: Date,
  input: { invoice: Invoice; count: number; periodSeconds: number; payerBusinessName: string; extensionDays?: number },
): Promise<Created> {
  const { invoice, count } = input;
  const outstanding = BigInt(invoice.amount) - BigInt(invoice.amountPaid);
  const { each } = splitInstalments(outstanding, count);
  if (each <= 0n) return { ok: false, code: "too_small" };
  const nowS = Math.floor(now.getTime() / 1000);
  const startAt = nowS + (input.extensionDays ?? 0) * 86_400;
  const row: typeof subscriptions.$inferSelect = {
    id: `0x${randomHex(32)}`,
    merchantId: invoice.merchantId,
    amount: each.toString(),
    periodSeconds: input.periodSeconds,
    maxCharges: count,
    startAt,
    customerEmail: invoice.customerEmail,
    payer: null,
    status: "offered",
    charges: 0,
    nextChargeAt: startAt,
    failedAttempts: 0,
    retryAt: null,
    subscribeTx: null,
    kind: "instalment",
    invoiceId: invoice.id,
    payerBusinessName: input.payerBusinessName,
    total: outstanding.toString(),
    atRiskReason: null,
    atRiskAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.insert(subscriptions).values(row);
  return { ok: true, row };
}
