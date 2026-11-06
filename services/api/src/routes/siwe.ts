import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { isAppOrigin, sessionContext, startSession } from "../auth";
import { passkeys, siweNonces, walletLogins } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { clientIp } from "../lib/request";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { SIWE_TTL_MS, checkSiweMessage } from "../verification/siwe";

/**
 * Wallet sign-in (EIP-4361), as a way to get into a business that ALREADY EXISTS.
 *
 * Decision: a wallet can never create a business. Creating one needs the passkey, because the passkey is the onchain
 * account's only signer; a wallet-only account would have nothing to sign refunds or payouts with. So:
 *   intent "link":  a business signed in with its passkey adds a wallet (proves it controls the wallet);
 *   intent "login": a linked wallet signs in; an unknown wallet gets "not linked", and nothing is created.
 * A wallet session can use the dashboard, but every onchain action still asks for the passkey.
 */
export const siweRoutes = new Hono<AppEnv>();

const MAX_WALLETS = 5;
const body = z.strictObject({
  message: z.string().min(1).max(2_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]{2,2000}$/),
  intent: z.enum(["link", "login"]),
});

siweRoutes.post("/nonce", async (c) => {
  const now = c.var.now();
  if (!(await hitRateLimit(c.var.db, `siwe:nonce:ip:${clientIp(c) ?? "unknown"}`, 60, 60, now))) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
  const nonce = randomHex(16);
  const expiresAt = new Date(now.getTime() + SIWE_TTL_MS).toISOString();
  await c.var.db.insert(siweNonces).values({ nonce, expiresAt });
  return c.json({ nonce, expiresAt });
});

siweRoutes.post("/verify", async (c) => {
  const { db, env } = { db: c.var.db, env: c.env };
  const now = c.var.now();
  if (!isAppOrigin(c.req.header("origin"), env)) return fail(c, 403, "csrf", "This request must come from the Stenmont app");
  if (!(await hitRateLimit(db, `siwe:verify:ip:${clientIp(c) ?? "unknown"}`, 30, 60, now))) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { message, signature, intent } = parsed.data;

  const app = new URL(env.APP_URL);
  const checked = checkSiweMessage(message, { domain: app.host, origin: app.origin, chainId: Number(env.WHITECHAIN_CHAIN_ID), now });
  if (!checked.ok) return fail(c, 400, "siwe_invalid", "The sign-in message was not accepted.", { reason: checked.reason });

  // Each nonce works once. It is spent before the signature is checked, so a failed attempt cannot be retried with the same message.
  const spent = await db
    .update(siweNonces)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(siweNonces.nonce, checked.message.nonce), isNull(siweNonces.usedAt), gt(siweNonces.expiresAt, now.toISOString())))
    .returning({ nonce: siweNonces.nonce });
  if (spent.length === 0) return fail(c, 400, "nonce_invalid", "This sign-in request is no longer valid. Start again.");

  const address = checked.message.address as Address;
  if (!(await c.var.chain.verifyWalletSignature({ address, message, signature: signature as Hex }))) return fail(c, 401, "bad_signature", "The signature does not match this wallet.");
  const key = address.toLowerCase();
  const [existing] = await db.select().from(walletLogins).where(eq(walletLogins.address, key));

  if (intent === "link") {
    const ctx = await sessionContext(c);
    if (!ctx) return fail(c, 401, "unauthorized", "Sign in with your passkey first, then add the wallet.");
    const merchantId = ctx.merchant.id;
    if (existing) {
      return existing.merchantId === merchantId ? c.json({ linked: true, address }) : fail(c, 409, "wallet_taken", "This wallet is already linked to another business.");
    }
    const mine = await db.select({ a: walletLogins.address }).from(walletLogins).where(eq(walletLogins.merchantId, merchantId));
    if (mine.length >= MAX_WALLETS) return fail(c, 409, "too_many_wallets", `A business can link at most ${MAX_WALLETS} wallets.`);
    const inserted = await db.insert(walletLogins).values({ address: key, merchantId, createdAt: now.toISOString() }).onConflictDoNothing().returning({ a: walletLogins.address });
    if (inserted.length === 0) return fail(c, 409, "wallet_taken", "This wallet is already linked to another business.");
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "wallet.linked", payload: { address } });
    return c.json({ linked: true, address });
  }

  if (!existing) return fail(c, 404, "wallet_not_linked", "This wallet is not linked to a business. Sign in with your passkey, then add the wallet under Verification.");
  const ctx = (await db.select().from(passkeys).where(eq(passkeys.merchantId, existing.merchantId)).orderBy(asc(passkeys.createdAt)).limit(1))[0];
  if (!ctx) return fail(c, 403, "not_activated", "Finish setting up your account first.");
  // startSession refuses nothing itself: a suspended or pending business is stopped by the session lookup on the next request.
  await startSession(c, existing.merchantId, ctx.id);
  await audit(db, { merchantId: existing.merchantId, actor: `wallet:${address}`, action: "session.started", payload: { method: "wallet" } });
  return c.json({ signedIn: true, address });
});

// ---- the linked wallets of the signed-in business (cookie session only: an API key must not add a way in) ---------------------

siweRoutes.get("/wallets", async (c) => {
  const ctx = await sessionContext(c);
  if (!ctx) return fail(c, 401, "unauthorized", "Not signed in");
  const rows = await c.var.db.select().from(walletLogins).where(eq(walletLogins.merchantId, ctx.merchant.id)).orderBy(asc(walletLogins.createdAt));
  const wallets = await Promise.all(rows.map(async (r) => ({ address: getAddress(r.address), ensName: await c.var.ens.primaryName(r.address as Address).catch(() => null), linkedAt: r.createdAt })));
  return c.json({ wallets });
});

siweRoutes.delete("/wallets/:address", async (c) => {
  if (!isAppOrigin(c.req.header("origin"), c.env)) return fail(c, 403, "csrf", "This request must come from the Stenmont app");
  const ctx = await sessionContext(c);
  if (!ctx) return fail(c, 401, "unauthorized", "Not signed in");
  const key = c.req.param("address").toLowerCase();
  const removed = await c.var.db.delete(walletLogins).where(and(eq(walletLogins.address, key), eq(walletLogins.merchantId, ctx.merchant.id))).returning({ a: walletLogins.address });
  if (removed.length) await audit(c.var.db, { merchantId: ctx.merchant.id, actor: `merchant:${ctx.merchant.id}`, action: "wallet.unlinked", payload: { address: key } });
  return c.body(null, 204);
});
