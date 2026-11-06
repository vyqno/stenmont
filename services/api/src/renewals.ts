import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { fromUnits } from "@stenmont/shared";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { subscriptionManagerAbi } from "@stenmont/shared";
import type { Db } from "./app";
import type { ChainClient } from "./chain";
import { subscriptions } from "./db/schema";
import type { Env } from "./env";
import { sendFromTank } from "./relayer/tankSend";
import { emitEvent } from "./webhooks";

const RETRY_AFTER_SECONDS = 86_400;
const MAX_ATTEMPTS = 3;
/** Most subscriptions one run handles; the rest wait for the next minute. */
const BATCH = 25;

/**
 * Charges every subscription that is due. The contract decides whether a charge is allowed; the schedule, count and
 * status are always re-read from it afterwards. A failed charge (customer short of funds or allowance) is retried a day
 * later, and after three failures the subscription is `past_due` and automatic tries stop. Problems on our side (an
 * empty gas tank, an RPC error) are never counted against the customer.
 */
export async function runRenewals(env: Env, db: Db, chain: ChainClient, now: Date): Promise<{ charged: number; failed: number }> {
  const nowS = Math.floor(now.getTime() / 1000);
  const due = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), lte(subscriptions.nextChargeAt, nowS), or(isNull(subscriptions.retryAt), lte(subscriptions.retryAt, nowS))))
    .limit(BATCH);
  let charged = 0;
  let failed = 0;

  for (const sub of due) {
    const data = encodeFunctionData({ abi: subscriptionManagerAbi, functionName: "charge", args: [sub.id as Hex] });
    const sent = await sendFromTank({ db, chain, now }, sub.merchantId, { to: env.SUBSCRIPTION_MANAGER_ADDRESS as Address, data });
    const stamp = now.toISOString();

    const resync = async () => {
      const st = await chain.subscriptionState(sub.id as Hex);
      const status = st.status === "completed" ? "completed" : st.status === "cancelled" ? "cancelled" : sub.status;
      await db.update(subscriptions).set({ charges: st.charges, nextChargeAt: Number(st.nextCharge), status, failedAttempts: 0, retryAt: null, updatedAt: stamp }).where(eq(subscriptions.id, sub.id));
      return { st, status };
    };

    if (sent.ok) {
      const { st, status } = await resync();
      charged++;
      await emitEvent(db, env.WEBHOOKS, sub.merchantId, {
        id: `evt_sub_${sub.id}_${st.charges}`,
        type: "subscription.charged",
        data: { subscription: { id: sub.id, status, amount: fromUnits(BigInt(sub.amount)), charges: st.charges, maxCharges: sub.maxCharges, payer: sub.payer }, txHash: sent.txHash },
      });
      continue;
    }
    if (sent.code === "rejected" && (sent.reason === "NotDue" || sent.reason === "NotActive")) {
      await resync(); // our mirror was behind the contract
      continue;
    }
    if (sent.code !== "rejected" && sent.code !== "tx_reverted") continue; // not the customer's doing

    const attempts = sub.failedAttempts + 1;
    failed++;
    if (attempts >= MAX_ATTEMPTS) {
      await db.update(subscriptions).set({ status: "past_due", failedAttempts: attempts, retryAt: null, updatedAt: stamp }).where(and(eq(subscriptions.id, sub.id), inArray(subscriptions.status, ["active"])));
      await emitEvent(db, env.WEBHOOKS, sub.merchantId, {
        id: `evt_sub_past_due_${sub.id}`,
        type: "subscription.past_due",
        data: { subscription: { id: sub.id, status: "past_due", amount: fromUnits(BigInt(sub.amount)), charges: sub.charges, payer: sub.payer }, reason: sent.code === "rejected" ? sent.reason : "reverted" },
      });
    } else {
      await db.update(subscriptions).set({ failedAttempts: attempts, retryAt: nowS + RETRY_AFTER_SECONDS, updatedAt: stamp }).where(eq(subscriptions.id, sub.id));
    }
  }
  return { charged, failed };
}
