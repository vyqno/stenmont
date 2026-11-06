import { and, desc, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../app";
import { isAppOrigin, sessionMerchant } from "../auth";
import { audit } from "../audit";
import { fail } from "../errors";
import { clientIp } from "../lib/request";
import { randomHex, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { oauthClients, oauthCodes, oauthGrants, oauthTokens } from "../oauth/schema";
import { parseScopes, SCOPES, type Scope } from "../oauth/scopes";
import { ACCESS_PREFIX, CODE_TTL_MS, issueTokens, REFRESH_PREFIX, revokeGrant } from "../oauth/tokens";
import { hitRateLimit } from "../relayer/caps";

type Ctx = Context<AppEnv>;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
/** RFC 6749 error body. */
const oerr = (c: Ctx, status: 400 | 401 | 429, error: string, description: string) => c.json({ error, error_description: description }, status, NO_STORE);

const str = (v: unknown) => (typeof v === "string" ? v : "");
async function bodyOf(c: Ctx): Promise<Record<string, unknown>> {
  try {
    if ((c.req.header("content-type") ?? "").includes("json")) {
      const b = await c.req.json();
      return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    }
    return Object.fromEntries(new URLSearchParams(await c.req.text()));
  } catch {
    return {};
  }
}

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const s256 = async (verifier: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** https anywhere, or http on this machine (desktop agents). No fragments, no credentials. */
function redirectUriOk(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 2000 || s.includes("#")) return false;
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname));
  } catch {
    return false;
  }
}

// ---- discovery and registration (called by agents, not browsers of ours) --------------------------------------------

export const oauthRoutes = new Hono<AppEnv>();
const anyone = cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type", "authorization"], maxAge: 600 });
oauthRoutes.use("/.well-known/*", anyone);
oauthRoutes.use("/oauth/register", anyone);
oauthRoutes.use("/oauth/token", anyone);
oauthRoutes.use("/oauth/revoke", anyone);
// The consent screen is our own app and carries the session cookie.
oauthRoutes.use(
  "/oauth/authorize",
  cors({ origin: (o, c) => (isAppOrigin(o, c.env) ? o : null), credentials: true, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 600 }),
);

oauthRoutes.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: c.env.API_URL,
    authorization_endpoint: `${c.env.APP_URL}/oauth/authorize`,
    token_endpoint: `${c.env.API_URL}/oauth/token`,
    registration_endpoint: `${c.env.API_URL}/oauth/register`,
    revocation_endpoint: `${c.env.API_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  }),
);

oauthRoutes.get("/.well-known/oauth-protected-resource", (c) =>
  c.json({ resource: c.env.API_URL, authorization_servers: [c.env.API_URL], scopes_supported: SCOPES, bearer_methods_supported: ["header"] }),
);

oauthRoutes.post("/oauth/register", async (c) => {
  if (!(await hitRateLimit(c.var.db, `oauth:register:${clientIp(c) ?? "unknown"}`, 20, 3600, c.var.now()))) return oerr(c, 429, "rate_limited", "Too many registrations. Try again later.");
  const b = await bodyOf(c);
  const name = str(b.client_name).trim();
  if (!name || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) return oerr(c, 400, "invalid_client_metadata", "client_name must be 1 to 80 plain characters");
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) return oerr(c, 400, "invalid_redirect_uri", "Give between 1 and 5 redirect_uris");
  if (!uris.every(redirectUriOk)) return oerr(c, 400, "invalid_redirect_uri", "Redirect addresses must be https (or http on localhost) and have no fragment");
  if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== "none") return oerr(c, 400, "invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are supported");
  const id = `mcp_${randomHex(12)}`;
  const createdAt = c.var.now();
  await c.var.db.insert(oauthClients).values({ id, name, redirectUris: JSON.stringify(uris), createdAt: createdAt.toISOString() });
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
    NO_STORE,
  );
});

// ---- the consent screen's two calls -----------------------------------------------------------------------------------

type AuthRequest = { clientId: string; clientName: string; redirectUri: string; scopes: Scope[]; challenge: string; state: string };

const redirectWith = (uri: string, params: Record<string, string>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};

/** Checks an authorization request. Until the redirect address is proven to be a registered one, nothing is ever redirected. */
async function checkAuthRequest(c: Ctx, p: Record<string, unknown>): Promise<AuthRequest | Response> {
  const [client] = await c.var.db.select().from(oauthClients).where(eq(oauthClients.id, str(p.client_id)));
  if (!client) return fail(c, 400, "invalid_client", "This app is not registered");
  const redirectUri = str(p.redirect_uri);
  if (!(JSON.parse(client.redirectUris) as string[]).includes(redirectUri)) return fail(c, 400, "invalid_redirect_uri", "This return address is not registered for the app");
  const state = str(p.state).slice(0, 500);
  const back = (code: string, message: string) => c.json({ error: { code, message }, redirectTo: redirectWith(redirectUri, { error: code, error_description: message, state }) }, 400);
  if (str(p.response_type) !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (!/^[A-Za-z0-9_-]{43}$/.test(str(p.code_challenge)) || str(p.code_challenge_method) !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  const scopes = parseScopes(str(p.scope));
  if (!scopes) return back("invalid_scope", "Unknown scope");
  return { clientId: client.id, clientName: client.name, redirectUri, scopes, challenge: str(p.code_challenge), state };
}

oauthRoutes.get("/oauth/authorize", async (c) => {
  const merchant = await sessionMerchant(c);
  if (!merchant) return fail(c, 401, "unauthorized", "Sign in to Stenmont first");
  const r = await checkAuthRequest(c, c.req.query());
  if (r instanceof Response) return r;
  return c.json({ client: { id: r.clientId, name: r.clientName }, redirectHost: new URL(r.redirectUri).host, scopes: r.scopes, business: merchant.name });
});

oauthRoutes.post("/oauth/authorize", async (c) => {
  if (!isAppOrigin(c.req.header("origin"), c.env)) return fail(c, 403, "csrf", "This request must come from the Stenmont app");
  const merchant = await sessionMerchant(c);
  if (!merchant) return fail(c, 401, "unauthorized", "Sign in to Stenmont first");
  const p = await bodyOf(c);
  const decision = str(p.decision);
  if (decision !== "approve" && decision !== "deny") return fail(c, 400, "invalid_request", "decision must be approve or deny");
  const r = await checkAuthRequest(c, p);
  if (r instanceof Response) return r;
  if (decision === "deny") return c.json({ redirectTo: redirectWith(r.redirectUri, { error: "access_denied", state: r.state }) });
  const code = randomHex(32);
  const now = c.var.now();
  await c.var.db.insert(oauthCodes).values({
    hash: await sha256Hex(code),
    clientId: r.clientId,
    merchantId: merchant.id,
    redirectUri: r.redirectUri,
    scopes: r.scopes.join(" "),
    codeChallenge: r.challenge,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  });
  return c.json({ redirectTo: redirectWith(r.redirectUri, { code, state: r.state }) });
});

// ---- tokens -----------------------------------------------------------------------------------------------------------

const invalidGrant = (c: Ctx, why = "The code or token is invalid, expired or already used") => oerr(c, 400, "invalid_grant", why);

oauthRoutes.post("/oauth/token", async (c) => {
  const { db } = c.var;
  const now = c.var.now();
  if (!(await hitRateLimit(db, `oauth:token:${clientIp(c) ?? "unknown"}`, 120, 60, now))) return oerr(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
  const b = await bodyOf(c);
  const type = str(b.grant_type);
  const clientId = str(b.client_id);

  if (type === "authorization_code") {
    const [code, redirectUri, verifier] = [str(b.code), str(b.redirect_uri), str(b.code_verifier)];
    if (!code || !redirectUri || !clientId) return oerr(c, 400, "invalid_request", "code, redirect_uri and client_id are required");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oerr(c, 400, "invalid_request", "code_verifier is required (43 to 128 characters)");
    const hash = await sha256Hex(code);
    const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.hash, hash));
    if (!row) return invalidGrant(c);
    const grantId = `g_${hash.slice(0, 24)}`; // derived, so a replay can always find and end the grant
    if (row.usedAt) {
      await revokeGrant(db, now, grantId, `oauth:${row.clientId}`, "code_reused");
      return invalidGrant(c);
    }
    const challengeOk = timingSafeEqual(await s256(verifier), row.codeChallenge);
    if (row.clientId !== clientId || row.redirectUri !== redirectUri || row.expiresAt <= now.toISOString() || !challengeOk) return invalidGrant(c);
    // The grant exists before the code is marked used, so whoever loses a race can still end it.
    await db.insert(oauthGrants).values({ id: grantId, merchantId: row.merchantId, clientId, scopes: row.scopes, createdAt: now.toISOString() }).onConflictDoNothing();
    const won = await db.update(oauthCodes).set({ usedAt: now.toISOString(), grantId }).where(and(eq(oauthCodes.hash, hash), isNull(oauthCodes.usedAt))).returning({ hash: oauthCodes.hash });
    if (won.length === 0) {
      await revokeGrant(db, now, grantId, `oauth:${clientId}`, "code_reused");
      return invalidGrant(c);
    }
    await audit(db, { merchantId: row.merchantId, actor: `oauth:${clientId}`, action: "oauth.grant.created", payload: { grantId, scopes: row.scopes } });
    return c.json(await issueTokens(db, now, grantId, row.scopes), 200, NO_STORE);
  }

  if (type === "refresh_token") {
    const refresh = str(b.refresh_token);
    if (!refresh || !clientId) return oerr(c, 400, "invalid_request", "refresh_token and client_id are required");
    const hash = await sha256Hex(refresh);
    const [row] = await db
      .select({ usedAt: oauthTokens.usedAt, expiresAt: oauthTokens.expiresAt, kind: oauthTokens.kind, grantId: oauthGrants.id, clientId: oauthGrants.clientId, scopes: oauthGrants.scopes, revokedAt: oauthGrants.revokedAt })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(and(eq(oauthTokens.hash, hash), eq(oauthTokens.kind, "refresh")));
    if (!row || row.clientId !== clientId || row.revokedAt || row.expiresAt <= now.toISOString()) return invalidGrant(c);
    const rotated = row.usedAt
      ? []
      : await db.update(oauthTokens).set({ usedAt: now.toISOString() }).where(and(eq(oauthTokens.hash, hash), isNull(oauthTokens.usedAt))).returning({ hash: oauthTokens.hash });
    if (rotated.length === 0) {
      // A rotated token came back: either it leaked or two copies are racing. End the grant; the person can connect again.
      await revokeGrant(db, now, row.grantId, `oauth:${clientId}`, "refresh_reused");
      return invalidGrant(c);
    }
    return c.json(await issueTokens(db, now, row.grantId, row.scopes), 200, NO_STORE);
  }

  return oerr(c, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
});

/** RFC 7009. Always answers 200, so it cannot be used to probe which tokens exist. */
oauthRoutes.post("/oauth/revoke", async (c) => {
  const b = await bodyOf(c);
  const token = str(b.token);
  if (token.startsWith(ACCESS_PREFIX) || token.startsWith(REFRESH_PREFIX)) {
    const [row] = await c.var.db
      .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(eq(oauthTokens.hash, await sha256Hex(token)));
    if (row && row.clientId === str(b.client_id)) await revokeGrant(c.var.db, c.var.now(), row.grantId, `oauth:${row.clientId}`, "revoked_by_app");
  }
  return c.json({}, 200, NO_STORE);
});

// ---- connected apps (the business's own view) -------------------------------------------------------------------------

export const oauthGrantRoutes = new Hono<AppEnv>();

oauthGrantRoutes.get("/grants", async (c) => {
  const rows = await c.var.db
    .select({ id: oauthGrants.id, clientId: oauthGrants.clientId, clientName: oauthClients.name, scopes: oauthGrants.scopes, createdAt: oauthGrants.createdAt })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(oauthGrants.merchantId, c.var.merchantId), isNull(oauthGrants.revokedAt)))
    .orderBy(desc(oauthGrants.createdAt));
  return c.json({ data: rows.map((r) => ({ ...r, scopes: r.scopes.split(" ") })) });
});

oauthGrantRoutes.delete("/grants/:id", async (c) => {
  const id = c.req.param("id");
  const [own] = await c.var.db.select({ id: oauthGrants.id }).from(oauthGrants).where(and(eq(oauthGrants.id, id), eq(oauthGrants.merchantId, c.var.merchantId)));
  if (!own || !(await revokeGrant(c.var.db, c.var.now(), id, `merchant:${c.var.merchantId}`, "revoked_by_merchant"))) return fail(c, 404, "not_found", "Connected app not found");
  return c.json({ id, revoked: true });
});
