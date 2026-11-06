import { whitechainSepolia } from "@stenmont/shared";

/** The five records the API manages. The agent card and trust badge are published from their own pages. */
export const RECORD_KEYS = ["stenmont.pay", "stenmont.x402", "stenmont.token", "stenmont.refund", "stenmont.limits"] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];
export type OmitReason = "not_https" | "host_not_verified" | "too_long" | "bad_text" | "no_cap";

export type DirectoryView = {
  inputs: { payUrl: string | null; x402Url: string | null; refund: string | null };
  records: Partial<Record<RecordKey, string>>;
  omitted: { key: RecordKey; reason: OmitReason }[];
  published: Record<string, string>;
  publishedAt: string | null;
  txHash: string | null;
};
export type PublishAnswer = {
  status: "published" | "unchanged";
  name?: string;
  records: Partial<Record<RecordKey, string>>;
  omitted: { key: RecordKey; reason: OmitReason }[];
  txHash?: string;
};

export const RECORD_INFO: Record<RecordKey, { label: string; help: string; derived: boolean }> = {
  "stenmont.pay": { label: "Pay link", help: "Where a customer or an agent goes to pay you. Must be on a website you have confirmed.", derived: false },
  "stenmont.x402": { label: "Agent payment address", help: "The address an AI agent calls to pay for something automatically. Optional.", derived: false },
  "stenmont.token": { label: "Money accepted", help: "Set by Stenmont: the dollar-pegged currency you are paid in. You cannot change it.", derived: true },
  "stenmont.refund": { label: "Refund policy", help: "A short statement, or a link on a confirmed website. Optional.", derived: false },
  "stenmont.limits": { label: "Largest invoice", help: "Set by Stenmont from your verification level. It rises when you verify more.", derived: true },
};

export const OMIT_TEXT: Record<OmitReason, string> = {
  host_not_verified: "Left out: this address is not on a website you have confirmed. Confirm the website under Connect first.",
  not_https: "Left out: the address must start with https:// and be a normal web address.",
  too_long: "Left out: this text is longer than 280 characters.",
  bad_text: "Left out: this text has line breaks, an unsafe link, or an address that is not https.",
  no_cap: "Left out: you have no invoice limit yet. Confirm your email to get one.",
};

export const REFUND_MAX = 280;

export function urlProblem(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > 2048) return "That address is too long.";
  try {
    const u = new URL(text);
    if (u.protocol !== "https:") return "The address must start with https://.";
    if (u.username || u.password) return "Remove the user name or password from the address.";
    return null;
  } catch {
    return "Enter a full web address, like https://pay.example.com/checkout.";
  }
}

/** Plain-words problem with a refund policy, or null. Mirrors the server, which stays the authority. */
export function refundProblem(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > REFUND_MAX) return `Keep it to ${REFUND_MAX} characters. It is ${text.length} now.`;
  if (/[\u0000-\u001f\u007f]/.test(text)) return "Use one line, without line breaks.";
  if (/^(javascript|data|vbscript|file|blob):/i.test(text) || /^http:\/\//i.test(text)) return "A link must start with https://.";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return urlProblem(text);
  return null;
}

export type FormValues = { payUrl: string; x402Url: string; refund: string };
export const formFrom = (v: DirectoryView | null): FormValues => ({ payUrl: v?.inputs.payUrl ?? "", x402Url: v?.inputs.x402Url ?? "", refund: v?.inputs.refund ?? "" });

export function formProblems(f: FormValues): Partial<Record<keyof FormValues, string>> {
  const out: Partial<Record<keyof FormValues, string>> = {};
  const a = urlProblem(f.payUrl);
  if (a) out.payUrl = a;
  const b = urlProblem(f.x402Url);
  if (b) out.x402Url = b;
  const c = refundProblem(f.refund);
  if (c) out.refund = c;
  return out;
}

/** An empty box clears the record (null). Every box is sent, so what you see is what is saved. */
export const publishBody = (f: FormValues) => ({ payUrl: f.payUrl.trim() || null, x402Url: f.x402Url.trim() || null, refund: f.refund.trim() || null });

/** True when the boxes differ from what is saved on the server, so the preview below is out of date. */
export function hasUnsavedEdits(f: FormValues, v: DirectoryView | null): boolean {
  const s = formFrom(v);
  return (["payUrl", "x402Url", "refund"] as const).some((k) => f[k].trim() !== s[k].trim());
}

export type RowState = "new" | "changed" | "removed" | "same" | "left_out" | "none";
export type RecordRow = { key: RecordKey; label: string; help: string; derived: boolean; published: string | null; next: string | null; state: RowState; note: string | null };

/** One row per record: what ENS shows now, what would be shown after publishing, and why anything is left out. */
export function recordRows(v: Pick<DirectoryView, "records" | "omitted" | "published"> | null): RecordRow[] {
  return RECORD_KEYS.map((key) => {
    const published = v?.published[key] || null;
    const next = v?.records[key] ?? null;
    const left = v?.omitted.find((o) => o.key === key);
    let state: RowState = "none";
    if (left) state = published ? "removed" : "left_out";
    else if (next && !published) state = "new";
    else if (next && published !== next) state = "changed";
    else if (next) state = "same";
    else if (published) state = "removed";
    return { key, ...RECORD_INFO[key], published, next, state, note: left ? OMIT_TEXT[left.reason] : null };
  });
}

export const STATE_TEXT: Record<RowState, string> = {
  new: "Will be added",
  changed: "Will change",
  removed: "Will be removed",
  same: "Up to date",
  left_out: "Left out",
  none: "Not set",
};

/** Number of records a publish would write. */
export const pendingChanges = (rows: RecordRow[]) => rows.filter((r) => r.state === "new" || r.state === "changed" || r.state === "removed").length;

/** Shows "Up to $2,000 per invoice" for the limits record; any other value is shown as it is. */
export function displayValue(key: RecordKey, value: string | null): string {
  if (!value) return "Nothing";
  if (key === "stenmont.limits") {
    try {
      const l = JSON.parse(value) as { perInvoice?: string };
      if (l.perInvoice) return `Up to $${Number(l.perInvoice).toLocaleString("en-US")} per invoice`;
    } catch { /* shown as stored */ }
  }
  if (key === "stenmont.token") {
    const m = /^eip155:(\d+)\/erc20:(0x[0-9a-fA-F]{40})$/.exec(value);
    if (m && Number(m[1]) === whitechainSepolia.id) return "Dollar-pegged USDT";
  }
  return value;
}

export function publishErrorText(code: string, payoutLocked: boolean): string {
  if (code === "no_name") return "Give your business a name first, on the Identity page.";
  if (code === "rate_limited") return "Too many changes just now. Try again later.";
  if (code === "chain_error") {
    return payoutLocked
      ? "It could not be published. Your payout was locked before this profile existed, so these records can no longer be written. Nothing was changed."
      : "It could not be published right now. Nothing was changed. Try again.";
  }
  if (code === "idempotency_in_progress") return "That is still being published. Wait a moment, then check this page.";
  return "It could not be published. Check the boxes and try again.";
}

export const explorerTx = (hash: string) => `${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`;

/** The same key for the same boxes, so a double click or a retry publishes once; new boxes get a new key. */
export function keeper(make: () => string = () => crypto.randomUUID()) {
  let sig = "";
  let key = "";
  return {
    keyFor(body: unknown) {
      const s = JSON.stringify(body);
      if (s !== sig) {
        sig = s;
        key = make();
      }
      return key;
    },
  };
}
