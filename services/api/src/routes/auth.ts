import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { hashTypedData, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  b64urlDecode,
  b64urlEncode,
  encodeWebAuthnSignature,
  parseDerSignature,
  routerDomain,
  setCreatorTypes,
  spkiToPublicKey,
  verifyAssertion,
} from "@stenmont/shared";
import type { AppEnv, Db } from "../app";
import { audit } from "../audit";
import { endSession, isAppOrigin, sessionContext, startSession } from "../auth";
import { apiKeys, authChallenges, gasTanks, merchants, passkeys } from "../db/schema";
import { fail } from "../errors";
import { randomHex, sha256Hex } from "../lib/crypto";
import { clientIp } from "../lib/request";
import { invalid } from "../lib/validation";
import { DEFAULT_DAILY_GAS_CAP_WEI, DEFAULT_PER_PAYER_DAILY_CAP_USDT, dayOf, hitRateLimit } from "../relayer/caps";

export const authRoutes = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
type Kind = "register" | "activate" | "login";

const MIN = 60_000;
const TTL: Record<Kind, number> = { register: 10 * MIN, activate: 60 * MIN, login: 5 * MIN };
const LOCK_MS = MIN; // how long one request holds a challenge while it works (a crash frees it after this)
/** A new business's passkey account uses the all-zero salt: one account per passkey. */
const ACCOUNT_SALT = `0x${"00".repeat(32)}` as Hex;
/** Test environments only: gas set aside for a new business so its first customers can pay without a top-up. */
const STARTER_TANK_WEI = 10n ** 16n;

const activateLimit = (env: { ACTIVATE_IP_LIMIT?: string }) => Number(env.ACTIVATE_IP_LIMIT) || 5;
const rpIdOf = (appUrl: string) => new URL(appUrl).hostname;
const b64 = z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/);
const businessName = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N} .,'&()-]{2,80}$/u, "2 to 80 letters, numbers or . , ' & ( ) -");
const assertionBody = z.strictObject({ challengeId: b64, credentialId: b64, authenticatorData: b64, clientDataJSON: b64, signature: b64 });
type AssertionBody = z.infer<typeof assertionBody>;

// ---- challenges -----------------------------------------------------------------------------------------------------

async function newChallenge(db: Db, kind: Kind, now: Date, over: { bytes?: Uint8Array; merchantId?: string; data?: unknown } = {}) {
  const bytes = over.bytes ?? crypto.getRandomValues(new Uint8Array(32));
  const id = randomHex(16);
  await db.insert(authChallenges).values({
    id,
    kind,
    challenge: b64urlEncode(bytes),
    merchantId: over.merchantId ?? null,
    data: JSON.stringify(over.data ?? {}),
    expiresAt: new Date(now.getTime() + TTL[kind]).toISOString(),
    createdAt: now.toISOString(),
  });
  return { id, challenge: b64urlEncode(bytes) };
}

/** The challenge, if it is of this kind, unused and not expired. Does not hold it. */
async function openChallenge(db: Db, id: string, kind: Kind, now: Date) {
  const [row] = await db
    .select()
    .from(authChallenges)
    .where(and(eq(authChallenges.id, id), eq(authChallenges.kind, kind), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, now.toISOString())));
  return row ?? null;
}

/** Holds the challenge for one request. Only one request can hold it at a time. */
async function claim(db: Db, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(authChallenges)
    .set({ claimedAt: now.toISOString() })
    .where(
      and(
        eq(authChallenges.id, id),
        isNull(authChallenges.usedAt),
        or(isNull(authChallenges.claimedAt), lt(authChallenges.claimedAt, new Date(now.getTime() - LOCK_MS).toISOString())),
      ),
    )
    .returning({ id: authChallenges.id });
  return rows.length > 0;
}
const release = (db: Db, id: string) => db.update(authChallenges).set({ claimedAt: null }).where(eq(authChallenges.id, id));
const finish = (db: Db, id: string, now: Date) => db.update(authChallenges).set({ usedAt: now.toISOString() }).where(eq(authChallenges.id, id));

const limited = (c: Ctx) => fail(c, 429, "rate_limited", "Too many attempts. Try again later.");
const badChallenge = (c: Ctx) => fail(c, 400, "invalid_challenge", "This request expired or was already used. Start again.");
const denied = (c: Ctx) => fail(c, 401, "unauthorized", "The passkey could not be verified.");

/** Checks a passkey assertion against the stored key and challenge, and advances the signature counter. */
export async function checkAssertion(c: Ctx, challenge: string, b: Omit<AssertionBody, "challengeId">, merchantId?: string | null) {
  const [pk] = await c.var.db.select().from(passkeys).where(eq(passkeys.id, b.credentialId));
  if (!pk || (merchantId && pk.merchantId !== merchantId)) return null;
  let parts: { authenticatorData: Uint8Array; clientDataJSON: string; der: Uint8Array };
  try {
    parts = {
      authenticatorData: b64urlDecode(b.authenticatorData),
      clientDataJSON: new TextDecoder().decode(b64urlDecode(b.clientDataJSON)),
      der: b64urlDecode(b.signature),
    };
  } catch {
    return null;
  }
  const result = await verifyAssertion({
    authenticatorData: parts.authenticatorData,
    clientDataJSON: parts.clientDataJSON,
    signatureDer: parts.der,
    publicKey: { x: pk.qx as Hex, y: pk.qy as Hex },
    expectedChallenge: b64urlDecode(challenge),
    expectedOrigin: c.env.APP_URL,
    expectedRpId: rpIdOf(c.env.APP_URL),
    requireUserVerification: true,
  });
  if (!result.ok) return null;
  // A counter that does not go up means a copied or replayed authenticator. Many passkeys always report 0: allow that.
  if ((result.counter !== 0 || pk.counter !== 0) && result.counter <= pk.counter) return null;
  const advanced = await c.var.db
    .update(passkeys)
    .set({ counter: result.counter })
    .where(and(eq(passkeys.id, pk.id), eq(passkeys.counter, pk.counter)))
    .returning({ id: passkeys.id });
  if (advanced.length === 0) return null;
  return { pk, parts };
}

// ---- registration ---------------------------------------------------------------------------------------------------

authRoutes.post("/register/options", async (c) => {
  const now = c.var.now();
  if (!(await hitRateLimit(c.var.db, `register:ip:${clientIp(c) ?? "unknown"}`, activateLimit(c.env) * 2, 3_600, now))) return limited(c);
  const parsed = z.strictObject({ businessName }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const name = parsed.data.businessName;
  const ch = await newChallenge(c.var.db, "register", now, { data: { businessName: name } });
  return c.json({
    challengeId: ch.id,
    options: {
      rp: { name: "Stenmont", id: rpIdOf(c.env.APP_URL) },
      user: { id: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))), name, displayName: name },
      challenge: ch.challenge,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (P-256) only: the one curve the chain can verify
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
    },
  });
});

authRoutes.post("/register/verify", async (c) => {
  const parsed = z.strictObject({ challengeId: b64, credentialId: b64, publicKey: b64, clientDataJSON: b64 }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const { db, chain } = c.var;
  const now = c.var.now();

  const row = await openChallenge(db, b.challengeId, "register", now);
  if (!row) return badChallenge(c);

  let key: { x: Hex; y: Hex };
  try {
    const client = JSON.parse(new TextDecoder().decode(b64urlDecode(b.clientDataJSON))) as { type?: string; challenge?: string; origin?: string };
    if (client.type !== "webauthn.create" || client.challenge !== row.challenge || client.origin !== c.env.APP_URL) {
      return fail(c, 400, "invalid_passkey", "The passkey response did not match this request.");
    }
    const spki = b64urlDecode(b.publicKey);
    await crypto.subtle.importKey("spki", spki as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); // must be a real P-256 key
    key = spkiToPublicKey(spki);
  } catch {
    return fail(c, 400, "invalid_passkey", "The passkey response could not be read.");
  }

  const [existing] = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.id, b.credentialId));
  if (existing) return fail(c, 409, "already_registered", "This passkey is already registered. Sign in instead.");
  if (!(await claim(db, row.id, now))) return badChallenge(c);

  const name = (JSON.parse(row.data) as { businessName: string }).businessName;
  const account = await chain.passkeyAddress(key.x, key.y, ACCOUNT_SALT);
  const merchantId = `m_${randomHex(8)}`;
  const stamp = now.toISOString();
  await db.insert(merchants).values({ id: merchantId, name, address: account, payoutAddress: account, status: "pending", createdAt: stamp });
  await db.insert(passkeys).values({ id: b.credentialId, merchantId, qx: key.x, qy: key.y, counter: 0, createdAt: stamp });

  // The second prompt: the new passkey authorises the relayer to create invoices for the account. The challenge is the
  // exact digest the router will check, so the same signature works onchain.
  const creator = chain.relayerAddress();
  const deadline = Math.floor(now.getTime() / 1000) + TTL.activate / 1000;
  const digest = hashTypedData({
    domain: routerDomain(c.env.ROUTER_ADDRESS as Address),
    types: setCreatorTypes,
    primaryType: "SetCreator",
    message: { merchant: account, creator, allowed: true, deadline: BigInt(deadline), nonce: 0n },
  });
  const activation = await newChallenge(db, "activate", now, {
    bytes: Uint8Array.from(Buffer.from(digest.slice(2), "hex")),
    merchantId,
    data: { deadline, creator },
  });
  await finish(db, row.id, now);
  return c.json({ account, activation: { challengeId: activation.id, challenge: activation.challenge, deadline } }, 201);
});

// ---- activation -----------------------------------------------------------------------------------------------------

authRoutes.post("/activate", async (c) => {
  const { db, chain } = c.var;
  const now = c.var.now();
  // Each activation costs the platform gas, so it is limited per address of origin and across the whole platform.
  const ok = [
    await hitRateLimit(db, `activate:ip:${clientIp(c) ?? "unknown"}`, activateLimit(c.env), 3_600, now),
    await hitRateLimit(db, "activate:global", 200, 86_400, now),
  ];
  if (ok.includes(false)) return limited(c);

  const parsed = assertionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;

  const row = await openChallenge(db, b.challengeId, "activate", now);
  if (!row?.merchantId) return badChallenge(c);
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, row.merchantId));
  if (!merchant || merchant.status !== "pending") return badChallenge(c);

  const checked = await checkAssertion(c, row.challenge, b, row.merchantId);
  if (!checked) return denied(c);
  if (!(await claim(db, row.id, now))) return badChallenge(c);

  const { deadline, creator } = JSON.parse(row.data) as { deadline: number; creator: Address };
  let txHash: Hex;
  try {
    const { r, s } = parseDerSignature(checked.parts.der);
    const signature = encodeWebAuthnSignature({ r, s, authenticatorData: checked.parts.authenticatorData, clientDataJSON: checked.parts.clientDataJSON });
    ({ txHash } = await chain.activateMerchant({
      account: merchant.address as Address,
      qx: checked.pk.qx as Hex,
      qy: checked.pk.qy as Hex,
      salt: ACCOUNT_SALT,
      creator,
      deadline: BigInt(deadline),
      signature,
    }));
  } catch (e) {
    console.error("activateMerchant failed", e);
    await release(db, row.id);
    return fail(c, 502, "chain_error", "Your account could not be set up right now. Try again.");
  }

  const key = `sk_test_${randomHex(16)}`;
  const stamp = now.toISOString();
  await db.insert(apiKeys).values({
    id: `k_${randomHex(8)}`,
    merchantId: merchant.id,
    prefix: key.slice(8, 16),
    hash: await sha256Hex(key),
    scopes: "*",
    createdAt: stamp,
  });
  if (c.env.ENVIRONMENT !== "production") {
    await db.insert(gasTanks).values({
      merchantId: merchant.id,
      wbtBalance: STARTER_TANK_WEI.toString(),
      dailyCapWbt: DEFAULT_DAILY_GAS_CAP_WEI.toString(),
      spentDay: dayOf(now),
      perPayerDailyCapUsdt: DEFAULT_PER_PAYER_DAILY_CAP_USDT.toString(),
    });
  }
  await db.update(merchants).set({ status: "active" }).where(eq(merchants.id, merchant.id));
  await finish(db, row.id, now);
  await audit(db, { merchantId: merchant.id, actor: `passkey:${checked.pk.id}`, action: "merchant.activated", payload: { account: merchant.address, txHash } });
  await startSession(c, merchant.id, checked.pk.id);
  return c.json({ apiKey: key, merchant: { id: merchant.id, name: merchant.name, account: merchant.address } });
});

// ---- sign-in --------------------------------------------------------------------------------------------------------

authRoutes.post("/login/options", async (c) => {
  const now = c.var.now();
  if (!(await hitRateLimit(c.var.db, `login:ip:${clientIp(c) ?? "unknown"}`, 60, 60, now))) return limited(c);
  const ch = await newChallenge(c.var.db, "login", now);
  // No list of allowed credentials: the passkey itself says who is signing in, so there is no username to type.
  return c.json({ challengeId: ch.id, options: { challenge: ch.challenge, rpId: rpIdOf(c.env.APP_URL), userVerification: "required", timeout: 60_000 } });
});

authRoutes.post("/login/verify", async (c) => {
  const now = c.var.now();
  const { db } = c.var;
  if (!(await hitRateLimit(db, `login:verify:ip:${clientIp(c) ?? "unknown"}`, 30, 60, now))) return limited(c);
  const parsed = assertionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;

  const row = await openChallenge(db, b.challengeId, "login", now);
  if (!row) return badChallenge(c);
  const checked = await checkAssertion(c, row.challenge, b);
  if (!checked) return denied(c);
  if (!(await claim(db, row.id, now))) return badChallenge(c);
  await finish(db, row.id, now);

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, checked.pk.merchantId));
  if (!merchant) return denied(c);
  if (merchant.status !== "active") return fail(c, 403, "not_activated", "Finish setting up your account first.");
  await startSession(c, merchant.id, checked.pk.id);
  await audit(db, { merchantId: merchant.id, actor: `passkey:${checked.pk.id}`, action: "session.started", payload: {} });
  return c.json({ merchant: { id: merchant.id, name: merchant.name, account: merchant.address } });
});

// ---- session --------------------------------------------------------------------------------------------------------

authRoutes.get("/session", async (c) => {
  const ctx = await sessionContext(c);
  if (!ctx) return fail(c, 401, "unauthorized", "Not signed in");
  const { merchant } = ctx;
  return c.json({ merchant: { id: merchant.id, name: merchant.name, account: merchant.address }, credentialId: ctx.passkeyId });
});

authRoutes.post("/logout", async (c) => {
  if (!isAppOrigin(c.req.header("origin"), c.env)) return fail(c, 403, "csrf", "This request must come from the Stenmont app");
  await endSession(c);
  return c.body(null, 204);
});
