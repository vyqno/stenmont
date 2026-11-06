/** read < draft < write: each level includes the one before. */
export const SCOPES = ["read", "draft", "write"] as const;
export type Scope = (typeof SCOPES)[number];
const level = (s: Scope) => SCOPES.indexOf(s) + 1;

/** "read draft" to ["read", "draft"]; an empty request means read; anything unknown is null. */
export function parseScopes(raw: string | undefined): Scope[] | null {
  const words = (raw ?? "").split(" ").filter(Boolean);
  if (words.length === 0) return ["read"];
  if (!words.every((w): w is Scope => (SCOPES as readonly string[]).includes(w))) return null;
  return [...new Set(words)];
}

export const maxLevel = (scopes: readonly Scope[]) => Math.max(0, ...scopes.map(level));
export const covers = (granted: readonly Scope[], needed: Scope) => maxLevel(granted) >= level(needed);

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
/** Never reachable with an OAuth token, whatever its scope: confirming money moves, minting keys, managing connected apps. */
const NEVER = [/^\/v1\/agent-access(\/|$)/, /^\/v1\/collections\/(policy|actions)(\/|$)/, /^\/v1\/invoices\/[^/]+\/expire-install$/, /^\/v1\/oauth(\/|$)/, /^\/v1\/api-keys(\/|$)/, /^\/v1\/refunds\/[^/]+\/submit$/];
/** Drafts only prepare something that a person must still confirm. */
const DRAFTS = new Set(["POST /v1/collections/reminders", "POST /v1/collections/plans", "POST /v1/refunds", "POST /v1/approvals"]);

/** The scope a request needs, or null when OAuth tokens may never make it. */
export function requiredScope(method: string, rawPath: string): Scope | null {
  const path = rawPath.replace(/\/+$/, "") || "/";
  if (NEVER.some((r) => r.test(path))) return null;
  if (SAFE.has(method) || /^\/v1\/a2a\/[^/]+$/.test(path)) return "read";
  return DRAFTS.has(`${method} ${path}`) ? "draft" : "write";
}
