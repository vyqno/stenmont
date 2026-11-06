export type VerifyDeps = { fetch: typeof fetch; baseUrl: string; rpId: string; /** "production" or "staging": proofs from any other environment are refused. */ environment?: string };
export type VerifyResult =
  | { ok: true; nullifier: string; action: string | null; raw: unknown }
  | { ok: false; kind: "invalid_proof"; code: string; message: string }
  | { ok: false; kind: "upstream_error"; message: string };

const NULLIFIER = /^(0x[0-9a-f]{1,64}|[0-9]{1,78})$/i;
const upstream = (message: string): VerifyResult => ({ ok: false, kind: "upstream_error", message });

/**
 * Forwards the proof byte-for-byte to World's verifier and trusts nothing but its answer.
 * Anything that is not a clear "valid" or a clear 4xx rejection is `upstream_error` (route answers 502, stores nothing).
 */
export async function verifyProof(deps: VerifyDeps, proof: unknown, expectedAction: string): Promise<VerifyResult> {
  if (typeof proof !== "object" || proof === null) return { ok: false, kind: "invalid_proof", code: "malformed", message: "proof must be an object" };
  const claimed = (proof as { action?: unknown }).action;
  if (claimed !== undefined && claimed !== expectedAction)
    return { ok: false, kind: "invalid_proof", code: "action_mismatch", message: "proof was made for another action" };

  if (deps.environment && (proof as { environment?: unknown }).environment !== deps.environment)
    return { ok: false, kind: "invalid_proof", code: "wrong_environment", message: `this proof was not made for the ${deps.environment} environment` };

  let res: Response;
  try {
    res = await deps.fetch(`${deps.baseUrl.replace(/\/$/, "")}/api/v4/verify/${encodeURIComponent(deps.rpId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deps.environment ? { ...(proof as object), environment: deps.environment } : proof),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return upstream("World verification is unreachable");
  }
  let body: any;
  try {
    body = await res.json();
  } catch {
    return upstream("World returned an unreadable answer");
  }
  if (res.status >= 500 || res.status === 429) return upstream(`World verification failed (${res.status})`);
  if (res.status >= 400) {
    const code = typeof body?.code === "string" ? body.code : "verification_failed";
    return { ok: false, kind: "invalid_proof", code, message: typeof body?.detail === "string" ? body.detail : "World rejected the proof" };
  }
  if (res.status !== 200 || body?.success !== true) return { ok: false, kind: "invalid_proof", code: "verification_failed", message: "World did not confirm the proof" };
  if (deps.environment && body?.environment !== undefined && body.environment !== deps.environment)
    return { ok: false, kind: "invalid_proof", code: "wrong_environment", message: "World answered for a different environment" };
  const results: any[] | null = Array.isArray(body.results) ? body.results : null;
  if (results && results.some((r) => r?.success === false)) return { ok: false, kind: "invalid_proof", code: "verification_failed", message: "a credential did not verify" };
  const raw = body.nullifier ?? results?.find((r) => r?.nullifier)?.nullifier;
  // A "success" without a usable nullifier cannot be deduplicated: treat as an upstream fault, never as enrolment.
  if (typeof raw !== "string" || !NULLIFIER.test(raw)) return upstream("World answer carried no usable nullifier");
  // Stored as a plain number: "0x0abc" and "0xABC" are the same person, and text comparison would miss that.
  return { ok: true, nullifier: BigInt(raw).toString(), action: typeof body.action === "string" ? body.action : null, raw: body };
}

export type EnrollmentRow = { id: string; merchantId: string; action: string; nullifier: string; verifiedAt: string };

export interface WorldRepo {
  /** Must be atomic on UNIQUE(action, nullifier): the DB constraint is the anti-replay, not a prior read. */
  insertEnrollment(row: EnrollmentRow): Promise<"inserted" | "duplicate">;
  findByMerchant(merchantId: string, action: string): Promise<EnrollmentRow | null>;
  nullifiersFor(merchantIds: string[], action: string): Promise<Array<{ merchantId: string; nullifier: string }>>;
}

export type EnrolResult =
  | { ok: true; enrollment: EnrollmentRow }
  | { ok: false; kind: "already_enrolled" | "duplicate"; message: string }
  | Extract<VerifyResult, { ok: false }>;

/** One person, one business: the same (action, nullifier) cannot enrol twice, and a business enrols once. */
export async function enrol(
  repo: WorldRepo,
  deps: VerifyDeps & { now: () => Date; newId: () => string },
  input: { merchantId: string; action: string; proof: unknown },
): Promise<EnrolResult> {
  if (await repo.findByMerchant(input.merchantId, input.action))
    return { ok: false, kind: "already_enrolled", message: "this business is already verified" };
  const v = await verifyProof(deps, input.proof, input.action);
  if (!v.ok) return v;
  const enrollment: EnrollmentRow = {
    id: deps.newId(),
    merchantId: input.merchantId,
    action: input.action,
    nullifier: v.nullifier,
    verifiedAt: deps.now().toISOString(),
  };
  if ((await repo.insertEnrollment(enrollment)) === "duplicate")
    return { ok: false, kind: "duplicate", message: "this person has already verified a business" };
  return { ok: true, enrollment };
}
