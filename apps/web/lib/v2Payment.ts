import { isAddress, zeroAddress, type Address } from "viem";
import { fromUnits, toUnits } from "@stenmont/shared";
export { paymentNonce } from "../../../packages/shared/src/v2/payment";
import { routerFor } from "./pay";

export type InvoiceProtocol = {
  contractVersion?: string; routerAddress?: string; payout?: string; payerLock?: string | null;
  hook?: string | null; discountBps?: number; discountUntil?: number | null;
};
export type PaymentInvoice = InvoiceProtocol & { id: string; amount: string; amountPaid: string; remaining: string };
const address = (value: unknown): value is Address => typeof value === "string" && isAddress(value) && value.toLowerCase() !== zeroAddress;

// Retired v1 obligations remain payable; only reviewed historical addresses are admitted.
export const RETIRED_V1_ROUTER = "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929" as const;
export function trustedInvoiceRouter(invoice: InvoiceProtocol, host: string): Address {
  const currentV1 = routerFor(host);
  const version = invoice.contractVersion ?? "v1";
  if (version === "v1") {
    const saved = invoice.routerAddress ?? currentV1;
    if (![currentV1.toLowerCase(), RETIRED_V1_ROUTER.toLowerCase()].includes(saved.toLowerCase())) throw new Error("invalid_authorization");
    return saved as Address;
  }
  const reviewed = process.env.NEXT_PUBLIC_ROUTER_V2_ADDRESS;
  if (version !== "v2" || !address(reviewed) || reviewed.toLowerCase() === currentV1.toLowerCase() || reviewed.toLowerCase() === RETIRED_V1_ROUTER.toLowerCase() || invoice.routerAddress?.toLowerCase() !== reviewed.toLowerCase()) throw new Error("invalid_authorization");
  return reviewed;
}

export function assertPaymentPayer(invoice: InvoiceProtocol, payer: Address) {
  if (invoice.payerLock && invoice.payerLock.toLowerCase() !== zeroAddress && invoice.payerLock.toLowerCase() !== payer.toLowerCase()) throw new Error("wrong_payer");
}
/** Only API-resolved immutable invoice provenance is accepted; never query parameters or the current creation default. */
export function paymentPlan(invoice: PaymentInvoice, host: string, now = Math.floor(Date.now() / 1000)) {
  const version = invoice.contractVersion ?? "v1";
  const trustedRouter = trustedInvoiceRouter(invoice, host);
  if (version === "v1") {
    return { router: trustedRouter, value: invoice.remaining, validBefore: BigInt(now + 3600), discounted: false, contractVersion: "v1" as const };
  }
  if (version !== "v2" || !address(invoice.routerAddress) || !address(invoice.payout)) throw new Error("invalid_authorization");
  const bps = invoice.discountBps ?? 0;
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10000) throw new Error("invalid_authorization");
  if (bps && (!address(invoice.payerLock) || !Number.isSafeInteger(invoice.discountUntil) || !invoice.discountUntil || (invoice.hook && invoice.hook.toLowerCase() !== zeroAddress))) throw new Error("invalid_authorization");
  const discounted = bps > 0 && toUnits(invoice.amountPaid) === 0n && now <= invoice.discountUntil!;
  const face = toUnits(invoice.amount);
  return {
    router: trustedRouter, payout: invoice.payout, contractVersion: "v2" as const, discounted,
    value: discounted ? fromUnits(face - face * BigInt(bps) / 10000n) : invoice.remaining,
    validBefore: discounted ? BigInt(invoice.discountUntil!) + 1n : BigInt(now + 3600),
  };
}
/** EIP-3009 validBefore is exclusive. Never submit a now-expired discounted approval as a partial payment. */
export function assertPaymentFresh(plan: { discounted: boolean; validBefore: bigint }, now = Math.floor(Date.now() / 1000)) {
  if (plan.discounted && BigInt(now) >= plan.validBefore) throw new Error("discount_expired");
}
/** A discounted invoice settles below face value; reloaded receipts must show what was actually received. */
export const paymentReceiptAmount = (invoice: { amountPaid: string; remaining: string }) => toUnits(invoice.remaining) === 0n ? invoice.amountPaid : invoice.remaining;
