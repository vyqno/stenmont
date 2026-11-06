import { createHash, randomBytes } from "node:crypto";
import { sha256Hex } from "../../src/lib/crypto";
import { seedMerchant, setup } from "./app";

export type T = ReturnType<typeof setup>;
export const json = async (r: Response) => (await r.json()) as Record<string, any>;
export const REDIRECT = "https://agent.example/callback";
export const APP = "https://app.test";

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** A signed-in browser session for a seeded merchant: the cookie the passkey sign-in would have set. */
export async function sessionCookie(t: T, merchantId = "m_1") {
  const token = randomBytes(32).toString("hex");
  const now = t.clock.now;
  await t.db
    .prepare("insert into sessions (token_hash, merchant_id, passkey_id, expires_at, created_at) values (?,?,?,?,?)")
    .bind(await sha256Hex(token), merchantId, "pk_1", new Date(now.getTime() + 86_400_000).toISOString(), now.toISOString())
    .run();
  return `__Secure-stenmont_test=${token}`;
}

export const form = (o: Record<string, string>) => ({ body: new URLSearchParams(o).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "2.2.2.2" } });

export async function registerClient(t: T, redirect_uris: string[] = [REDIRECT], client_name = "Cool Agent") {
  const res = await t.req("/oauth/register", { method: "POST", body: JSON.stringify({ client_name, redirect_uris }), headers: { "cf-connecting-ip": "3.3.3.3" } });
  return { res, body: await json(res) };
}

export function authParams(client_id: string, over: Record<string, string> = {}) {
  const p = pkce();
  return { p, params: { response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: p.challenge, code_challenge_method: "S256", scope: "read", state: "xyz", ...over } };
}

export function decide(t: T, params: Record<string, string>, cookie: string | null, decision = "approve", headers: Record<string, string> = {}) {
  return t.req("/oauth/authorize", { method: "POST", body: JSON.stringify({ ...params, decision }), headers: { origin: APP, ...(cookie ? { cookie } : {}), ...headers } });
}

/** Register, approve and exchange: returns the tokens and what was needed to get them. */
export async function connect(t: T, scope = "read", merchantId = "m_1") {
  const { body: client } = await registerClient(t);
  const cookie = await sessionCookie(t, merchantId);
  const { p, params } = authParams(client.client_id, { scope });
  const approved = await json(await decide(t, params, cookie));
  const code = new URL(approved.redirectTo).searchParams.get("code")!;
  const res = await t.req("/oauth/token", { method: "POST", ...form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: p.verifier }) });
  return { client, cookie, code, p, params, res, tokens: await json(res) };
}

export { seedMerchant, setup };
