import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import { randomHex, sha256Hex } from "../lib/crypto";
export const identityCookie = (c: Context<AppEnv>) => `stenmont_identity_${c.env.ENVIRONMENT}`;
const options = { httpOnly: true, secure: true, sameSite: "Lax" as const, path: "/", maxAge: 86400, prefix: "secure" as const };
export type Identity = { id: string; provider: string; subject: string; email: string; merchant_id: string | null };
export async function openIdentity(c: Context<AppEnv>) {
  const token = getCookie(c, identityCookie(c), "secure");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return c.env.DB.prepare("SELECT i.* FROM identity_subjects i JOIN identity_sessions s ON s.identity_id=i.id WHERE s.token_hash=? AND s.expires_at>?").bind(await sha256Hex(token), c.var.now().toISOString()).first<Identity>();
}
export async function clearIdentity(c: Context<AppEnv>) {
  const token = getCookie(c, identityCookie(c), "secure");
  if (token) await c.env.DB.prepare("DELETE FROM identity_sessions WHERE token_hash=?").bind(await sha256Hex(token)).run();
  deleteCookie(c, identityCookie(c), options);
}
export async function establishIdentity(c: Context<AppEnv>, provider: string, subject: string, email: string) {
  const id = randomHex(16);
  await c.env.DB.prepare("INSERT INTO identity_subjects(id,provider,subject,email,created_at) VALUES(?,?,?,?,?) ON CONFLICT(provider,subject) DO NOTHING").bind(id, provider, subject, email, c.var.now().toISOString()).run();
  const row = await c.env.DB.prepare("SELECT * FROM identity_subjects WHERE provider=? AND subject=?").bind(provider, subject).first<Identity>();
  if (!row) throw Error("Identity unavailable");
  await clearIdentity(c);
  const token = randomHex(32);
  await c.env.DB.prepare("INSERT INTO identity_sessions(token_hash,identity_id,expires_at) VALUES(?,?,?)").bind(await sha256Hex(token), row.id, new Date(c.var.now().getTime()+86400_000).toISOString()).run();
  setCookie(c, identityCookie(c), token, options);
  return row;
}
