import { hashTypedData, type Address, type Hex } from "viem";
import { buildPermit, cancelSubscriptionTypes, subscribeTypes, subscriptionDomain, toUnits } from "@stenmont/shared";

/** What the public subscription page returns: the terms the business set. The customer signs exactly these. */
export type Terms = {
  id: Hex;
  status: string;
  merchantName: string;
  merchantAddress: Address;
  payout: Address;
  amount: string;
  periodSeconds: number;
  maxCharges: number;
  startAt: number;
  manager: Address;
};

/** The digest the customer's passkey signs to agree to these terms. */
export function subscribeDigest(t: Terms, payer: Address, deadline: bigint): Hex {
  return hashTypedData({
    domain: subscriptionDomain(t.manager),
    types: subscribeTypes,
    primaryType: "Subscribe",
    message: {
      id: t.id,
      payer,
      merchant: t.merchantAddress,
      payout: t.payout,
      amount: toUnits(t.amount),
      periodSeconds: t.periodSeconds,
      startAt: BigInt(t.startAt),
      maxCharges: t.maxCharges,
      deadline,
    },
  });
}

/** The permit lets the agreement charge, and no more: all charges the terms allow, on top of what is already approved. */
export function permitDigest(t: Terms, payer: Address, p: { allowance: string; nonce: bigint; deadline: bigint }): Hex {
  const cap = toUnits(t.amount) * BigInt(t.maxCharges);
  return hashTypedData(buildPermit({ owner: payer, spender: t.manager, value: toUnits(p.allowance) + cap, nonce: p.nonce, deadline: p.deadline }));
}

export function permitValue(t: Terms, allowance: string): bigint {
  return toUnits(allowance) + toUnits(t.amount) * BigInt(t.maxCharges);
}

export function cancelDigest(t: Terms, deadline: bigint): Hex {
  return hashTypedData({ domain: subscriptionDomain(t.manager), types: cancelSubscriptionTypes, primaryType: "CancelSubscription", message: { id: t.id, deadline } });
}

/** "30 days", "week" style wording for "every ___". */
export function describePeriod(seconds: number): string {
  const unit = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  return unit(Math.round(seconds / 60), "minute");
}
