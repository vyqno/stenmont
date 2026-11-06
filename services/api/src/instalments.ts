import type { EventType } from "./events";
import { randomHex } from "./lib/crypto";
import type { Db } from "./app";
import { instalmentCharges, invoices, subscriptions } from "./db/schema";

export const DEFAULT_PERIOD_SECONDS = 30 * 86_400;
/** Executable plans are always two or three charges, even if a human approves an exception. */
export const MAX_PARTS = 3;

/** Remainder belongs to the first charge; each agreement below is bounded independently by the existing manager. */
export function splitInstalments(total: bigint, count: number): { each: bigint; rounding: bigint; first: bigint } {
  if (!Number.isInteger(count) || count < 2 || count > MAX_PARTS || total <= 0n) throw new Error("invalid instalment terms");
  const n = BigInt(count);
  return { each: total / n, rounding: total % n, first: total / n + total % n };
}
export type Segment = { id: string; amount: string; maxCharges: number; startAt: number };
export function agreementSegments(row: typeof subscriptions.$inferSelect): Segment[] {
  return row.segments ? JSON.parse(row.segments) as Segment[] : [{ id: row.id, amount: row.amount, maxCharges: row.maxCharges, startAt: row.startAt }];
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
  if (input.payerBusinessName.trim().length < 2) throw new Error("payer legal name required");
  const { each, first, rounding } = splitInstalments(outstanding, count);
  if (each <= 0n) return { ok: false, code: "too_small" };
  const nowS = Math.floor(now.getTime() / 1000);
  const startAt = nowS + (input.extensionDays ?? 0) * 86_400;
  const id = `0x${randomHex(32)}`;
  const segments: Segment[] | null = rounding === 0n ? null : [
    { id, amount: first.toString(), maxCharges: 1, startAt },
    { id: `0x${randomHex(32)}`, amount: each.toString(), maxCharges: count - 1, startAt: startAt + input.periodSeconds },
  ];
  const row: typeof subscriptions.$inferSelect = {
    id,
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
    segments: segments ? JSON.stringify(segments) : null,
    atRiskReason: null,
    atRiskAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.insert(subscriptions).values(row);
  return { ok: true, row };
}

/** Read every signed agreement: aggregate count and exact paid value survive cron retries and direct onchain charges. */
export async function readAgreementState(chain: import("./chain").ChainClient, row: typeof subscriptions.$inferSelect) {
  const segments = agreementSegments(row);
  const states = await Promise.all(segments.map(s => chain.subscriptionState(s.id as `0x${string}`)));
  const charges = states.reduce((n, s) => n + s.charges, 0);
  const paid = states.reduce((n, s, i) => n + BigInt(segments[i]!.amount) * BigInt(s.charges), 0n);
  const next = states.findIndex(s => s.status === "active");
  const status = states.some(s => s.status === "cancelled") ? "cancelled" : states.every(s => s.status === "completed") ? "completed" : "active";
  return { charges, paid, status, nextCharge: next < 0 ? 0n : states[next]!.nextCharge, chargeId: segments[Math.max(0, next)]!.id, amount: segments[Math.max(0, next)]!.amount };
}

/** Call only after a successful submitted charge. A state-only resync cannot invent a receipt. */
export async function recordInstalmentCharge(
  deps: { db: Db; chain: import("./chain").ChainClient; now: Date },
  input: { sub: typeof subscriptions.$inferSelect; payer: string; agreementId: string; amount: string; txHash: `0x${string}` },
) {
  const { sub, agreementId, txHash } = input;
  if (!sub.invoiceId) throw new Error("instalment invoice required");
  let gasCostWbt: string | null = null;
  try {
    const receipt = await deps.chain.waitForReceipt(txHash);
    if (receipt.status === "success") gasCostWbt = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
  } catch { /* The successful sender receipt is already known; a secondary gas lookup may fail. */ }
  await deps.db.insert(instalmentCharges).values({ id: `${txHash}:${agreementId}`, merchantId: sub.merchantId, invoiceId: sub.invoiceId, subscriptionId: sub.id, agreementId, payer: input.payer, amount: input.amount, txHash, observedAt: deps.now.toISOString(), gasCostWbt }).onConflictDoNothing();
}
