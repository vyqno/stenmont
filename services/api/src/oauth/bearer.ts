import { and, eq, gt, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { merchants } from "../db/schema";
import { sha256Hex } from "../lib/crypto";
import { oauthGrants, oauthTokens } from "./schema";
import { covers, parseScopes, requiredScope, type Scope } from "./scopes";
import { ACCESS_PREFIX } from "./tokens";

const TOKEN = new RegExp(`^${ACCESS_PREFIX}[0-9a-f]{64}$`);

/** True when the Authorization header carries one of our OAuth access tokens (API keys look different). */
export const isOAuthBearer = (header: string | undefined) => !!header && header.startsWith(`Bearer ${ACCESS_PREFIX}`);

const resourceMetadata = (c: Context<AppEnv>) => `resource_metadata="${c.env.API_URL}/.well-known/oauth-protected-resource"`;
const unauthorized = (c: Context<AppEnv>) =>
  c.json({ error: { code: "unauthorized", message: "Missing, expired or revoked access token" } }, 401, {
    "www-authenticate": `Bearer error="invalid_token", ${resourceMetadata(c)}`,
  });
const forbidden = (c: Context<AppEnv>, needed: Scope | null) =>
  c.json(
    { error: { code: "insufficient_scope", message: needed ? `This needs the "${needed}" permission` : "Connected apps cannot do this" } },
    403,
    { "www-authenticate": `Bearer error="insufficient_scope", ${needed ? `scope="${needed}", ` : ""}${resourceMetadata(c)}` },
  );

/** An OAuth access token: finds the business it was granted by and enforces the grant's scopes on this request. */
export const requireOAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = (c.req.header("authorization") ?? "").slice(7).trim();
  if (!TOKEN.test(token)) return unauthorized(c);
  const { db } = c.var;
  const [row] = await db
    .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId, merchantId: oauthGrants.merchantId, scopes: oauthGrants.scopes })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .where(and(eq(oauthTokens.hash, await sha256Hex(token)), eq(oauthTokens.kind, "access"), gt(oauthTokens.expiresAt, c.var.now().toISOString()), isNull(oauthGrants.revokedAt)));
  if (!row) return unauthorized(c);
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, row.merchantId));
  if (!merchant || merchant.status !== "active") return unauthorized(c);

  const needed = requiredScope(c.req.method, c.req.path);
  if (!needed || !covers(parseScopes(row.scopes) ?? [], needed)) return forbidden(c, needed);
  if (needed === "write") {
    await audit(db, { merchantId: merchant.id, actor: `oauth:${row.clientId}`, action: "oauth.write_used", payload: { grantId: row.grantId, method: c.req.method, path: c.req.path } });
  }
  c.set("merchantId", merchant.id);
  c.set("merchant", merchant);
  await next();
});
