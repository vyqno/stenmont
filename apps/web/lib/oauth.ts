const KEYS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

/** The OAuth parameters of an authorization link, and nothing else. The server validates them again. */
export function parseAuthorizeQuery(search: string): Record<string, string> {
  const q = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const v = q.get(k);
    if (v !== null && v.length <= 2000) out[k] = v;
  }
  return out;
}

const WORDS: Record<string, string> = {
  read: "See your invoices, payments and exports",
  draft: "Prepare refunds for you to review. Nothing is sent until you confirm it with your passkey",
  write: "Create and change invoices, payment links, webhooks and subscriptions",
};

export const scopeWords = (scopes: string[]) => scopes.map((s) => WORDS[s] ?? `Unknown permission "${s}"`);

export const signInHref = (pathAndQuery: string) => `/login?next=${encodeURIComponent(pathAndQuery)}`;

/** Where to go after signing in: a path on this site, never another address. */
export function safeNext(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null;
}

/** The address the server asks us to send the visitor to must be a web address (never javascript: or data:). */
export function safeReturn(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
