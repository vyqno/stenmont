import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Merchant } from "./app";
import { fail } from "./errors";
import { apiKeys, merchants, sessions } from "./db/schema";
import { randomHex, sha256Hex, timingSafeEqual } from "./lib/crypto";
import type { Env } from "./env";
import { isOAuthBearer, requireOAuth } from "./oauth/bearer";

const KEY = /^sk_test_[0-9a-f]{32}$/;

export const requireApiKey = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!KEY.test(key)) return fail(c, 401, "unauthorized", "Missing or invalid API key");

  const db = c.var.db;
  const prefix = key.slice(8, 16);
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)));
  const hash = await sha256Hex(key);
  const match = rows.find((r) => timingSafeEqual(r.hash, hash));
  if (!match) return fail(c, 401, "unauthorized", "Missing or invalid API key");

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, match.merchantId));
  if (!merchant || merchant.status !== "active") return fail(c, 401, "unauthorized", "Missing or invalid API key");
  c.set("merchantId", merchant.id);
  c.set("merchant", merchant);
  await next();
});

// ---------------------------------------------------------------------------------------------------------------------
// Browser sessions (passkey sign-in)

const SESSION_DAYS = 7;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Our own app (and localhost outside production): the only origins that may use cookies. */
export const isAppOrigin = (origin: string | undefined, env: Env): origin is string =>
  !!origin && (origin === env.APP_URL || (env.ENVIRONMENT !== "production" && /^http:\/\/localhost:\d+$/.test(origin)));

/** The cookie name carries the environment so staging and production never read each other's sessions on a shared domain. */
const cookieName = (env: Env) => (env.ENVIRONMENT === "production" ? "stenmont" : `stenmont_${env.ENVIRONMENT}`);
const cookieOptions = (env: Env) => ({
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
  prefix: "secure" as const,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

export async function startSession(c: Context<AppEnv>, merchantId: string, passkeyId: string): Promise<void> {
  const token = randomHex(32);
  const now = c.var.now();
  await c.var.db.insert(sessions).values({
    tokenHash: await sha256Hex(token),
    merchantId,
    passkeyId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  setCookie(c, cookieName(c.env), token, { ...cookieOptions(c.env), maxAge: SESSION_DAYS * 86_400 });
}

const sessionToken = (c: Context<AppEnv>) => {
  const token = getCookie(c, cookieName(c.env), "secure");
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
};

export async function sessionMerchant(c: Context<AppEnv>): Promise<Merchant | null> {
  return (await sessionContext(c))?.merchant ?? null;
}

/** The signed-in business and the passkey this session was started with. */
export async function sessionContext(c: Context<AppEnv>): Promise<{ merchant: Merchant; passkeyId: string } | null> {
  const token = sessionToken(c);
  if (!token) return null;
  const [row] = await c.var.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, await sha256Hex(token)), gt(sessions.expiresAt, c.var.now().toISOString())));
  if (!row) return null;
  const [merchant] = await c.var.db.select().from(merchants).where(eq(merchants.id, row.merchantId));
  return merchant?.status === "active" ? { merchant, passkeyId: row.passkeyId } : null;
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = sessionToken(c);
  if (token) await c.var.db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
  deleteCookie(c, cookieName(c.env), cookieOptions(c.env));
}

/** An API key (servers), an OAuth access token (connected apps and agents) or a session cookie (our app). A cookie may change things only when the request comes from our own app. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header("authorization");
  if (isOAuthBearer(authorization)) return requireOAuth(c, next);
  if (authorization) return requireApiKey(c, next);
  const merchant = await sessionMerchant(c);
  if (!merchant) return fail(c, 401, "unauthorized", "Missing or invalid API key");
  if (!SAFE_METHODS.has(c.req.method) && !isAppOrigin(c.req.header("origin"), c.env)) {
    return fail(c, 403, "csrf", "This request must come from the Stenmont app");
  }
  c.set("merchantId", merchant.id);
  c.set("merchant", merchant);
  await next();
});
