import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../app";
import { audit } from "../audit";
import { randomHex, sha256Hex } from "../lib/crypto";
import { oauthGrants, oauthTokens } from "./schema";

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86_400;

export const ACCESS_PREFIX = "smt_at_";
export const REFRESH_PREFIX = "smt_rt_";

/** Makes a fresh access and refresh token for a grant. The plaintext is returned here and stored nowhere. */
export async function issueTokens(db: Db, now: Date, grantId: string, scope: string) {
  const access = ACCESS_PREFIX + randomHex(32);
  const refresh = REFRESH_PREFIX + randomHex(32);
  const at = now.toISOString();
  const expires = (s: number) => new Date(now.getTime() + s * 1000).toISOString();
  await db.delete(oauthTokens).where(and(eq(oauthTokens.grantId, grantId), lt(oauthTokens.expiresAt, at)));
  await db.insert(oauthTokens).values([
    { hash: await sha256Hex(access), grantId, kind: "access", expiresAt: expires(ACCESS_TTL_S), createdAt: at },
    { hash: await sha256Hex(refresh), grantId, kind: "refresh", expiresAt: expires(REFRESH_TTL_S), createdAt: at },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** Ends a grant and with it every token it issued. Returns false when it was already ended or unknown. */
export async function revokeGrant(db: Db, now: Date, grantId: string, actor: string, reason: string): Promise<boolean> {
  const [g] = await db
    .update(oauthGrants)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .returning({ merchantId: oauthGrants.merchantId });
  if (!g) return false;
  await audit(db, { merchantId: g.merchantId, actor, action: "oauth.grant.revoked", payload: { grantId, reason } });
  return true;
}
