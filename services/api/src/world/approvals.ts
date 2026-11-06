import type { OidcClaims } from "./oidc";

export type Operation = "refund" | "payout_change" | "agent_limit" | "collections_exception";
export type ApprovalStatus = "pending" | "approved" | "denied" | "consumed";
export type ApprovalRow = {
  id: string;
  merchantId: string;
  operation: Operation;
  paramsHash: string;
  /** Sent to World as the OIDC `nonce`; the returned token must carry it back. */
  nonce: string;
  status: ApprovalStatus;
  worldSub: string | null;
  authTime: number | null;
  denyReason: string | null;
  createdAt: string;
  expiresAt: string;
};

export interface ApprovalRepo {
  insert(row: ApprovalRow): Promise<void>;
  get(id: string): Promise<ApprovalRow | null>;
  /** Newest first. */
  list(merchantId: string, operation: Operation): Promise<ApprovalRow[]>;
  /** Compare-and-set: applies `patch` only if the row's status is still `from`. Must be one atomic UPDATE ... WHERE status = from. */
  transition(id: string, from: ApprovalStatus, patch: Partial<ApprovalRow>): Promise<boolean>;
}

export const APPROVAL_TTL_SECONDS = 300;
export const MAX_AUTH_AGE_SECONDS = 300;

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => [k, canonical((v as any)[k])]))
      : v;

/** sha256 of the stable-key-sorted JSON. Amounts must be strings (JSON has no bigint). */
export async function hashParams(params: object): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(params))));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createApproval(
  repo: ApprovalRepo,
  input: { merchantId: string; operation: Operation; params: object },
  deps: { now: Date; newId: () => string; newNonce: () => string },
): Promise<ApprovalRow> {
  const row: ApprovalRow = {
    id: deps.newId(),
    merchantId: input.merchantId,
    operation: input.operation,
    paramsHash: await hashParams(input.params),
    nonce: deps.newNonce(),
    status: "pending",
    worldSub: null,
    authTime: null,
    denyReason: null,
    createdAt: deps.now.toISOString(),
    expiresAt: new Date(deps.now.getTime() + APPROVAL_TTL_SECONDS * 1000).toISOString(),
  };
  await repo.insert(row);
  return row;
}

type Moved = { ok: true } | { ok: false; code: "not_found" | "not_pending" | "approval_expired" | "nonce_mismatch" | "stale_auth" };

/** Call only with claims that passed `verifyIdToken` for this approval's nonce. Re-checks nonce and auth age as defence in depth. */
export async function markApproved(repo: ApprovalRepo, id: string, claims: Pick<OidcClaims, "sub" | "auth_time" | "nonce">, now: Date): Promise<Moved> {
  const a = await repo.get(id);
  if (!a) return { ok: false, code: "not_found" };
  if (a.status !== "pending") return { ok: false, code: "not_pending" };
  if (now.getTime() >= Date.parse(a.expiresAt)) return { ok: false, code: "approval_expired" };
  if (claims.nonce !== a.nonce) return { ok: false, code: "nonce_mismatch" };
  if (typeof claims.auth_time !== "number" || now.getTime() / 1000 - claims.auth_time > MAX_AUTH_AGE_SECONDS) return { ok: false, code: "stale_auth" };
  const done = await repo.transition(id, "pending", { status: "approved", worldSub: claims.sub, authTime: claims.auth_time });
  return done ? { ok: true } : { ok: false, code: "not_pending" };
}

/** Denied, cancelled or failed sign-in. The protected action stays undone; `reason` is for the audit log. */
export async function markDenied(repo: ApprovalRepo, id: string, reason: string): Promise<Moved> {
  const done = await repo.transition(id, "pending", { status: "denied", denyReason: reason });
  return done ? { ok: true } : { ok: false, code: "not_pending" };
}

export type ApprovalErrorCode = "approval_required" | "approval_denied" | "approval_expired" | "approval_mismatch";
export type RequireResult = { ok: true; approvalId: string; worldSub: string } | { ok: false; code: ApprovalErrorCode; message: string };

const no = (code: ApprovalErrorCode, message: string): RequireResult => ({ ok: false, code, message });

/**
 * Gate for a risky action. Finds an approval for exactly this merchant, operation and params, still fresh, and consumes it
 * (approved -> consumed) in one compare-and-set, so a second call, or a concurrent one, gets `approval_required`.
 */
export async function requireApproval(
  repo: ApprovalRepo,
  input: { merchantId: string; operation: Operation; params: object; now: Date },
): Promise<RequireResult> {
  const nowMs = input.now.getTime();
  const hash = await hashParams(input.params);
  const rows = await repo.list(input.merchantId, input.operation);
  const mine = rows.filter((r) => r.paramsHash === hash);
  const fresh = (r: ApprovalRow) => nowMs < Date.parse(r.expiresAt) && r.authTime !== null && nowMs / 1000 - r.authTime <= MAX_AUTH_AGE_SECONDS;

  for (const r of mine) {
    if (r.status === "approved" && fresh(r) && (await repo.transition(r.id, "approved", { status: "consumed" })))
      return { ok: true, approvalId: r.id, worldSub: r.worldSub! };
  }
  const latest = mine[0];
  if (latest) {
    if (latest.status === "denied") return no("approval_denied", latest.denyReason ?? "the approval was denied");
    if (latest.status === "consumed") return no("approval_required", "this approval was already used");
    if (latest.status === "approved") return no("approval_expired", "the approval is too old");
    if (nowMs >= Date.parse(latest.expiresAt)) return no("approval_expired", "the approval request expired");
    return no("approval_required", "waiting for the approval to be completed");
  }
  if (rows.some((r) => r.status === "approved" && nowMs < Date.parse(r.expiresAt)))
    return no("approval_mismatch", "an approval exists, but for different details");
  return no("approval_required", "this action needs a human approval");
}

export function memoryApprovalRepo(): ApprovalRepo & { rows: ApprovalRow[] } {
  const rows: ApprovalRow[] = [];
  return {
    rows,
    async insert(row) {
      rows.push({ ...row });
    },
    async get(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async list(merchantId, operation) {
      return rows.filter((r) => r.merchantId === merchantId && r.operation === operation).map((r) => ({ ...r })).reverse();
    },
    async transition(id, from, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== from) return false;
      Object.assign(r, patch);
      return true;
    },
  };
}
