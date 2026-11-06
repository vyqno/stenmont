import { hashTypedData, type Address, type Hex } from "viem";
import { buildReceiveAuth, deployments, formatUSDT, toUnits } from "@stenmont/shared";

import { paymentNonce } from "../../../packages/shared/src/v2/payment";

/** One passkey, one account: the factory salt is fixed. */
export const ZERO_SALT = `0x${"00".repeat(32)}` as Hex;

export function apiBase(hostname: string, localApi = "http://localhost:8787"): string {
  if (hostname === "testnet.stenmont.com") return "https://api-testnet.stenmont.com";
  if (hostname === "app-staging.stenmont.com") return "https://api-staging.stenmont.com"; // the current staging names, until the testnet names are live
  if (hostname === "app.stenmont.com") return "https://api.stenmont.com";
  if (hostname === "localhost" || hostname === "127.0.0.1") return localApi;
  throw new Error(`unknown host: ${hostname}`);
}

export const isTestEnvironment = (hostname: string) => hostname !== "app.stenmont.com";

export function routerFor(hostname: string): Address {
  if (hostname === "app.stenmont.com") throw new Error("the production router is not deployed yet");
  return deployments.environments.staging.PaymentRouter.address;
}

/** "2.5" -> "$2.50" */
export const formatAmount = (decimal: string) => formatUSDT(toUnits(decimal));

export const b64urlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** The 32-byte digest the passkey signs: the token authorization, bound to this invoice through its nonce. */
export function payChallenge(a: { account: Address; router: Address; value: bigint; validBefore: bigint; invoiceId: Hex; salt: Hex; contractVersion?: string; payout?: Address }): Hex {
  return hashTypedData(
    buildReceiveAuth({
      from: a.account,
      to: a.router,
      value: a.value,
      validAfter: 0n,
      validBefore: a.validBefore,
      nonce: paymentNonce(a),
    }),
  );
}

/** Everything a customer can be told. Plain words only: no crypto vocabulary, ever (a test enforces it). */
export const FRIENDLY: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  invoice_not_found: "We couldn't find this invoice.",
  invoice_not_payable: "This invoice can't be paid any more.",
  payments_paused: "This business has paused payments for now. Please try again later.",
  gas_tank_empty: "This business can't take payments right now. Please contact them.",
  gas_cap_reached: "This business has reached today's limit. Please try again tomorrow.",
  payer_cap: "You've reached today's payment limit.",
  busy: "We're a little busy. Please try again in a moment.",
  duplicate: "This payment was already sent.",
  account_mismatch: "Something went wrong with your account. Please try again.",
  overpay: "That's more than what is still owed.",
  below_minimum: "That's below the minimum payment for this invoice.",
  discount_expired: "That early payment offer expired before approval. Nothing was charged. Review the current amount before trying again.",
  wrong_payer: "This invoice is reserved for someone else.",
  invalid_authorization: "Your payment couldn't be approved. Please try again.",
  relayer_low: "Payments are temporarily unavailable. Please try again soon.",
  chain_error: "We couldn't send your payment. Please try again.",
  tx_reverted: "Your payment didn't go through. You were not charged.",
  timeout: "Your payment is taking longer than usual. It may still go through.",
  faucet_limit: "Test funds were already added today.",
  cancelled: "The confirmation was cancelled.",
  subscription_rejected: "This agreement couldn't be approved. Please try again.",
  not_available: "This subscription is no longer available.",
  not_found: "We couldn't find this subscription.",
  invalid_link: "This link has expired or isn't valid.",
  wallet_network: "We couldn't switch your app to the right network. Please switch it and try again.",
  wallet_failed: "We couldn't complete that with your app. Please try again.",
  wallet_insufficient: "That account doesn't have enough funds for this payment. Pick another account or add funds.",
};

export const friendly = (code: string) => FRIENDLY[code] ?? "Something went wrong. Please try again.";

/** Which screen the pay page shows. A business that paused payments is "unavailable for now", not "missing". */
export function payViewKind(invoice: { status: string; paused?: boolean }): "ready" | "paid" | "paused" | "missing" {
  if (invoice.status === "paid") return "paid";
  if (invoice.status !== "open" && invoice.status !== "partially_paid") return "missing";
  return invoice.paused ? "paused" : "ready";
}
