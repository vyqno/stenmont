import { hashTypedData, type Address, type Hex } from "viem";
import { formatAmount } from "./pay";
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
  /** `instalment` = an invoice paid in parts (business to business). Absent or `subscription` = a normal subscription. */
  kind?: string;
  preparationRequired?: boolean;
  total?: string;
  payerBusinessName?: string | null;
  segments?: { id: Hex; amount: string; maxCharges: number; startAt: number }[];
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
  const cap = planCap(t);
  return hashTypedData(buildPermit({ owner: payer, spender: t.manager, value: toUnits(p.allowance) + cap, nonce: p.nonce, deadline: p.deadline }));
}

export function permitValue(t: Terms, allowance: string): bigint {
  return toUnits(allowance) + planCap(t);
}

export function planCap(t: Terms): bigint {
  return t.segments?.reduce((sum, s) => sum + toUnits(s.amount) * BigInt(s.maxCharges), 0n) ?? toUnits(t.amount) * BigInt(t.maxCharges);
}
export function signingTerms(t: Terms): Terms[] {
  return t.segments?.map(s => ({ ...t, ...s, segments: undefined })) ?? [t];
}

export function cancelDigest(t: Pick<Terms, "id" | "manager">, deadline: bigint): Hex {
  return hashTypedData({ domain: subscriptionDomain(t.manager), types: cancelSubscriptionTypes, primaryType: "CancelSubscription", message: { id: t.id, deadline } });
}

/** "30 days", "week" style wording for "every ___". */
export function describePeriod(seconds: number): string {
  const unit = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  return unit(Math.round(seconds / 60), "minute");
}

/** The words on the page where the customer agrees, for a subscription or for an invoice paid in parts. */
export function planCopy(t: Terms) {
  const spaced = describePeriod(t.periodSeconds);
  const visibility = `${t.merchantName} can see whether each payment will go through, so they can warn you before one fails.`;
  if (t.kind === "instalment" && t.total) {
    const first = t.segments?.[0]?.amount ?? t.amount;
    return {
      title: `Pay ${t.merchantName} in ${t.maxCharges} parts`,
      schedule: `First payment ${formatAmount(first)} now, then ${t.maxCharges - 1} payments of ${formatAmount(t.amount)}, one every ${spaced}.`,
      total: `Total ${formatAmount(t.total)}`,
      forBusiness: `A payment plan for ${t.payerBusinessName ?? "your business"}. Business purchases only.`,
      button: `Start paying in ${t.maxCharges} parts`,
      working: "Starting your payment plan…",
      done: "Your payment plan has started",
      doneText: `${t.merchantName} takes ${formatAmount(first)} first, then ${formatAmount(t.amount)} every ${spaced}, ${t.maxCharges} payments in all.`,
      consent: `Confirm ${t.segments?.length === 2 ? "both agreements and permission for the total" : "the agreement and payment permission"} on your device. Only the amounts shown can be taken; you can stop the plan any time.`,
      visibility,
    };
  }
  return {
    title: `Subscribe to ${t.merchantName}`,
    schedule: `every ${spaced}, up to ${t.maxCharges} payments`,
    total: null,
    forBusiness: null,
    button: `Subscribe for ${formatAmount(t.amount)}`,
    working: "Starting your subscription…",
    done: "You're subscribed",
    doneText: `${t.merchantName} will take ${formatAmount(t.amount)} every ${spaced}, at most ${t.maxCharges} times.`,
    consent: "The first payment is taken now. You confirm twice with Face ID, your fingerprint or your device PIN, and you can cancel any time.",
    visibility,
  };
}
