import { and, eq, gt, lte } from "drizzle-orm";
import type { Address } from "viem";
import { fromUnits } from "@stenmont/shared";
import type { Db } from "./app";
import type { ChainClient } from "./chain";
import { subscriptions } from "./db/schema";
import type { Env } from "./env";
import { readAgreementState } from "./instalments";
import { emitEvent } from "./webhooks";

const AHEAD_SECONDS = 86_400;
/** Most subscriptions one run looks at; the rest wait for the next hour. */
const BATCH = 50;

/**
 * One day before a charge, reads the payer's USDT balance and allowance (public onchain data). If the charge would fail,
 * the subscription is marked `at_risk` and the business gets `subscription.at_risk` once for that charge, so it can ask
 * the customer to top up. This only warns: it never delays, skips or changes the charge itself. A payer who tops up is
 * cleared on the next run, and an unreadable chain flags nobody.
 */
export async function runPreflight(env: Env, db: Db, chain: ChainClient, now: Date): Promise<{ checked: number; atRisk: number }> {
  const nowS = Math.floor(now.getTime() / 1000);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), gt(subscriptions.nextChargeAt, nowS), lte(subscriptions.nextChargeAt, nowS + AHEAD_SECONDS)))
    .limit(BATCH);
  let checked = 0;
  let atRisk = 0;
  for (const sub of rows) {
    if (!sub.payer) continue;
    checked++;
    let amount = BigInt(sub.amount);
    let reason: "balance" | "allowance" | null;
    try {
      if (sub.segments) amount = BigInt((await readAgreementState(chain, sub)).amount);
      const [balance, allowance] = await Promise.all([chain.usdtBalance(sub.payer as Address), chain.usdtAllowance(sub.payer as Address, env.SUBSCRIPTION_MANAGER_ADDRESS as Address)]);
      reason = balance < amount ? "balance" : allowance < amount ? "allowance" : null;
    } catch (e) {
      console.error("pre-flight read failed", e);
      continue; // our problem, not the customer's
    }
    if (reason === null) {
      if (sub.atRiskReason) await db.update(subscriptions).set({ atRiskReason: null, atRiskAt: null }).where(eq(subscriptions.id, sub.id));
      continue;
    }
    atRisk++;
    const first = sub.atRiskReason === null;
    if (first || sub.atRiskReason !== reason) await db.update(subscriptions).set({ atRiskReason: reason, atRiskAt: first ? now.toISOString() : sub.atRiskAt }).where(eq(subscriptions.id, sub.id));
    // The event id names the upcoming charge, so running this again, or a change of reason, never repeats the warning.
    await emitEvent(db, env.WEBHOOKS, sub.merchantId, {
      id: `evt_at_risk_${sub.id}_${sub.charges + 1}`,
      type: "subscription.at_risk",
      data: {
        subscription: { id: sub.id, kind: sub.kind, invoiceId: sub.invoiceId, payer: sub.payer },
        reason,
        charge: { number: sub.charges + 1, of: sub.maxCharges, amount: fromUnits(amount), dueAt: new Date(sub.nextChargeAt * 1000).toISOString() },
      },
    });
  }
  return { checked, atRisk };
}
