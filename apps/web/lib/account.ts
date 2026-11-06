import { apiBase } from "./pay";

const KEY = "stenmont.account.v1";
const TOKEN_RE = /^v1\.[0-9a-f]{40}\.receipts\.\d{1,12}\.[A-Za-z0-9_-]{20,64}$/;

type Store = Pick<Storage, "getItem" | "setItem">;

/** The token lives in the address fragment (never sent to a server, never in a log or a Referer). */
export function tokenFromHash(hash: string): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return t && TOKEN_RE.test(t) ? t : null;
}

export const accountUrl = (origin: string, token: string) => `${origin}/account#t=${token}`;

/** Remembers the newest link on this device so the customer can come back without the original. Storage may be blocked: then we simply do not remember. */
export function saveAccountToken(store: Store, token: string) {
  if (!TOKEN_RE.test(token)) return;
  try {
    store.setItem(KEY, token);
  } catch {
    /* private window or blocked storage */
  }
}
export function loadAccountToken(store: Store): string | null {
  try {
    const t = store.getItem(KEY);
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** For display only. The server checks the signature and the expiry. */
export const tokenPayer = (token: string) => `0x${token.split(".")[1]}`;
export const tokenExpired = (token: string, now: Date) => Number(token.split(".")[3]) * 1000 <= now.getTime();

export type Summary = {
  payer: `0x${string}`;
  payments: { invoiceNumber: string; merchantName: string; amount: string; at: string; receiptUrl: string }[];
  refunds: { invoiceNumber: string; merchantName: string; amount: string; at: string; receiptUrl: string }[];
  subscriptions: { id: `0x${string}`; merchantName: string; amount: string; periodSeconds: number; maxCharges: number; charges: number; status: string; nextChargeAt: string | null; manager: `0x${string}` }[];
};

export async function fetchSummary(hostname: string, token: string): Promise<{ ok: true; summary: Summary } | { ok: false; reason: "invalid" | "unavailable" }> {
  try {
    const res = await fetch(`${apiBase(hostname)}/account/summary`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return { ok: true, summary: (await res.json()) as Summary };
    return { ok: false, reason: res.status === 401 ? "invalid" : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

const STATUS: Record<string, string> = { active: "Active", cancelled: "Ended", completed: "Finished", past_due: "Payment failed" };
export const statusLabel = (s: string) => STATUS[s] ?? "Unknown";

/** Plain words only: no crypto vocabulary on this page (a test enforces it). */
export const ACCOUNT_COPY = {
  title: "Your receipts",
  intro: "Everything you've paid, anything you were refunded, and your subscriptions, in one place.",
  keep: "Keep this link for your receipts",
  keepHint: "It works for 7 days and shows only your own payments. Anyone with the link can see them, so keep it private.",
  expired: "This link has expired or isn't valid. Pay again, or ask the shop for a new one. Your payments are still safe.",
  unavailable: "Receipts aren't available right now. Please try again in a moment.",
  noLink: "Open the receipts link you were given after paying.",
  empty: { payments: "No payments yet.", refunds: "No refunds.", subscriptions: "No subscriptions." },
  cancelHelp: "You'll confirm with Face ID, your fingerprint or your device PIN. No more payments will be taken.",
  cancelOtherDevice: "To end this subscription, open this page on the device you subscribed from.",
  cancelled: "Subscription ended. No more payments will be taken.",
} as const;
