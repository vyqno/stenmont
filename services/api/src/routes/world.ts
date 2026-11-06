import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { sessionMerchant } from "../auth";
import { audit } from "../audit";
import { approvals as approvalsTable, worldEnrollments } from "../db/schema";
import type { Env } from "../env";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { invalid } from "../lib/validation";
import { createApproval, markApproved, markDenied, type Operation } from "../world/approvals";
import { d1ApprovalRepo, d1WorldRepo } from "../world/d1";
import { createOidcVerifier } from "../world/oidc";
import { createRpContext } from "../world/rp";
import { enrol } from "../world/verify";

const base64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const ENROL_ACTION = "enrol-business";
const ACTIONS = new Set([ENROL_ACTION]);
const OPERATIONS = ["refund", "payout_change", "agent_limit"] as const;

/** "production" in production, "staging" everywhere else, unless set explicitly. Proofs from any other environment are refused. */
const environmentOf = (env: Env) => env.WORLD_ENVIRONMENT ?? (env.ENVIRONMENT === "production" ? "production" : "staging");
const issuerOf = (env: Env) => (env.WORLD_OIDC_ISSUER ?? "https://auth.world.org").replace(/\/$/, "");

// ---- one person, one business (IDKit) --------------------------------------------------------------------------------

export const worldRoutes = new Hono<AppEnv>();

worldRoutes.post("/rp-signature", async (c) => {
  const parsed = z.strictObject({ action: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!ACTIONS.has(parsed.data.action)) return fail(c, 400, "invalid_request", "Unknown action");
  const { WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY } = c.env;
  if (!WORLD_APP_ID || !WORLD_RP_ID || !WORLD_RP_SIGNING_KEY) return fail(c, 503, "world_unavailable", "Identity verification is not available right now.");
  const rp_context = await createRpContext({ rpId: WORLD_RP_ID, action: parsed.data.action, signingKey: WORLD_RP_SIGNING_KEY as `0x${string}`, now: c.var.now });
  return c.json({ app_id: WORLD_APP_ID, environment: environmentOf(c.env), rp_context });
});

worldRoutes.post("/verify", async (c) => {
  const parsed = z.strictObject({ action: z.string(), idkitResponse: z.record(z.string(), z.unknown()) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!ACTIONS.has(parsed.data.action)) return fail(c, 400, "invalid_request", "Unknown action");
  if (!c.env.WORLD_RP_ID) return fail(c, 503, "world_unavailable", "Identity verification is not available right now.");
  const { db, merchantId } = c.var;

  const out = await enrol(
    d1WorldRepo(db),
    { fetch: c.var.fetch, baseUrl: c.env.WORLD_VERIFY_URL ?? "https://developer.world.org", rpId: c.env.WORLD_RP_ID, environment: environmentOf(c.env), now: c.var.now, newId: () => crypto.randomUUID() },
    { merchantId, action: parsed.data.action, proof: parsed.data.idkitResponse },
  );
  if (out.ok) {
    await db.update(worldEnrollments).set({ proofEnvironment: environmentOf(c.env) }).where(eq(worldEnrollments.merchantId, merchantId));
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "world.enrolled", payload: { action: parsed.data.action } });
    return c.json({ enrolled: true });
  }
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "world.enrol_refused", payload: { kind: out.kind, code: out.kind === "invalid_proof" ? out.code : undefined } });
  if (out.kind === "already_enrolled") return fail(c, 409, "already_enrolled", "This business is already verified.");
  if (out.kind === "duplicate") return fail(c, 409, "duplicate", "This person has already verified a business.");
  if (out.kind === "invalid_proof") return fail(c, 422, out.code, "The verification was not accepted.");
  return fail(c, 502, "world_error", "Identity verification could not be completed right now. Try again.");
});

worldRoutes.get("/status", async (c) => {
  const row = await d1WorldRepo(c.var.db).findByMerchant(c.var.merchantId, ENROL_ACTION);
  return c.json({ enrolled: !!row, verifiedAt: row?.verifiedAt ?? null });
});

// ---- step-up approvals (World Agent Pass, OIDC) -----------------------------------------------------------------------

export const approvalRoutes = new Hono<AppEnv>();

approvalRoutes.post("/", async (c) => {
  const parsed = z.strictObject({ operation: z.enum(OPERATIONS), params: z.record(z.string(), z.unknown()) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!c.env.WORLD_OIDC_CLIENT_ID) return fail(c, 503, "world_unavailable", "Approvals are not available right now.");
  const row = await createApproval(
    d1ApprovalRepo(c.var.db),
    { merchantId: c.var.merchantId, operation: parsed.data.operation as Operation, params: parsed.data.params },
    { now: c.var.now(), newId: () => randomHex(16), newNonce: () => randomHex(16) },
  );
  // PKCE (S256): the browser only ever sees the challenge; the verifier stays here and is sent when the code is exchanged.
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  await c.var.db.update(approvalsTable).set({ pkceVerifier: verifier }).where(eq(approvalsTable.id, row.id));
  const url = new URL(`${issuerOf(c.env)}/api/v1/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.env.WORLD_OIDC_CLIENT_ID,
    redirect_uri: `${c.env.API_URL}/auth/world/callback`,
    scope: "openid",
    state: row.id,
    nonce: row.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login", // ask for a fresh sign-in: an old session must not count as approval
  }).toString();
  return c.json({ id: row.id, status: row.status, expiresAt: row.expiresAt, authorizeUrl: url.toString() }, 201);
});

approvalRoutes.get("/:id", async (c) => {
  const row = await d1ApprovalRepo(c.var.db).get(c.req.param("id"));
  if (!row || row.merchantId !== c.var.merchantId) return fail(c, 404, "not_found", "Approval not found");
  return c.json({ id: row.id, operation: row.operation, status: row.status, expiresAt: row.expiresAt, denyReason: row.denyReason });
});

/** Where World sends the person back to. Only the signed-in business that asked can complete its own approval. */
export const worldAuthRoutes = new Hono<AppEnv>();

worldAuthRoutes.get("/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const repo = d1ApprovalRepo(c.var.db);
  const approval = state ? await repo.get(state) : null;
  if (!approval) return fail(c, 400, "invalid_request", "Unknown approval");
  const me = await sessionMerchant(c);
  if (!me) return fail(c, 401, "unauthorized", "Sign in first");
  if (me.id !== approval.merchantId) return fail(c, 403, "forbidden", "This approval belongs to another business");

  const destination = approval.operation === "agent_limit" ? "identity" : "invoices";
  const back = (result: "approved" | "denied") => c.redirect(`${c.env.APP_URL}/dashboard/${destination}?approval=${approval.id}&result=${result}`, 302);
  const deny = async (reason: string) => {
    await markDenied(repo, approval.id, reason);
    await audit(c.var.db, { merchantId: approval.merchantId, actor: "world", action: "approval.denied", payload: { id: approval.id, reason } });
    return back("denied");
  };

  const err = c.req.query("error");
  if (err) return deny(err);
  const code = c.req.query("code");
  if (!code || !c.env.WORLD_OIDC_CLIENT_ID || !c.env.WORLD_OIDC_CLIENT_SECRET) return deny("missing_code");

  const [stored] = await c.var.db.select({ v: approvalsTable.pkceVerifier }).from(approvalsTable).where(eq(approvalsTable.id, approval.id));
  if (!stored?.v) return deny("missing_pkce");
  let idToken: string | undefined;
  try {
    const res = await c.var.fetch(`${issuerOf(c.env)}/api/v1/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${c.env.WORLD_OIDC_CLIENT_ID}:${c.env.WORLD_OIDC_CLIENT_SECRET}`)}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${c.env.API_URL}/auth/world/callback`, code_verifier: stored.v }),
    });
    if (res.ok) idToken = ((await res.json()) as { id_token?: string }).id_token;
  } catch {
    /* falls through to the denial below */
  }
  if (!idToken) return deny("token_exchange_failed");

  const verify = createOidcVerifier({ issuer: issuerOf(c.env), audience: c.env.WORLD_OIDC_CLIENT_ID, jwksUrl: `${issuerOf(c.env)}/.well-known/jwks.json`, fetch: c.var.fetch, now: c.var.now });
  const checked = await verify(idToken, { nonce: approval.nonce });
  if (!checked.ok) return deny(checked.reason);

  const moved = await markApproved(repo, approval.id, checked.claims, c.var.now());
  if (!moved.ok) return deny(moved.code);
  await audit(c.var.db, { merchantId: approval.merchantId, actor: "world", action: "approval.approved", payload: { id: approval.id, operation: approval.operation } });
  return back("approved");
});
