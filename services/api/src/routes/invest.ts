import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { MULTICALL3_ADDRESS, allowInvestorTypes, b64urlEncode, buildReceiveAuth, fromUnits, fundNonce, investorRegistryDomain, invoiceClaimAbi, multicall3Abi, passkeyAccountFactoryAbi } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { Rejected } from "../chain";
import { claimView, liveClaim, type ClaimRow } from "../claims";
import { claims, investorEnrollments, invoices, merchants } from "../db/schema";
import type { Env } from "../env";
import { fail } from "../errors";
import { clientIp } from "../lib/request";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { sendFromTank } from "../relayer/tankSend";
import { loadLimits, merchantTier, refused, tierLimitResponse } from "../verification/store";
import { checkInvestor } from "../verification/tiers";
import { createRpContext } from "../world/rp";
import { verifyProof } from "../world/verify";

export const ALLOW_ACTION = "allow-investor";
const ALLOW_VALID_DAYS = 180;
const ATTESTATION_SECONDS = 900;
const FUND_AUTH_SECONDS = 1_800;
/** Stop accepting a minute before the listing's last second, so a transaction never lands after it. */
const FUND_MARGIN_SECONDS = 60;
const MARKET_LIMIT = 50;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const invoiceParam = z.string().regex(/^0x[0-9a-f]{64}$/);
const environmentOf = (env: Env) => env.WORLD_ENVIRONMENT ?? (env.ENVIRONMENT === "production" ? "production" : "staging");

export const investRoutes = new Hono<AppEnv>();

const limited = (c: Context) => fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
const hit = async (c: Context<AppEnv>, key: string, limit: number) =>
  (await hitRateLimit(c.var.db, `${key}:ip:${clientIp(c) ?? "unknown"}`, limit, 60, c.var.now())) as boolean;

// ---- the market --------------------------------------------------------------------------------------------------------

type Reputation = { score: number; paid: number } | null;
async function reputation(c: { var: AppEnv["Variables"] }, addr: string | null): Promise<Reputation> {
  if (!addr) return null;
  try {
    const r = await c.var.chain.reputationOf(addr as Address);
    return { score: r.score, paid: r.onTime + r.late };
  } catch (e) {
    console.error("reputation lookup failed", e);
    return null;
  }
}

/** Percent with two places, from a ratio given in basis points. */
const pct = (bps: number) => (bps / 100).toFixed(2);

async function publicView(c: { var: AppEnv["Variables"] }, rows: ClaimRow[]) {
  if (rows.length === 0) return [];
  const { db } = c.var;
  const ms = await db.select().from(merchants).where(inArray(merchants.id, [...new Set(rows.map((r) => r.merchantId))]));
  const invs = await db.select().from(invoices).where(inArray(invoices.id, rows.map((r) => r.invoiceId)));
  const buyers = await db.select().from(merchants).where(inArray(merchants.id, invs.map((i) => i.buyerMerchantId).filter((x): x is string => !!x)));
  const nowS = Math.floor(c.var.now().getTime() / 1000);
  const scores = new Map<string, Reputation>();
  const score = async (addr: string | null) => {
    if (!addr) return null;
    if (!scores.has(addr)) scores.set(addr, await reputation(c, addr));
    return scores.get(addr)!;
  };
  const out = [];
  for (const r of rows) {
    const m = ms.find((x) => x.id === r.merchantId);
    const buyer = buyers.find((b) => b.id === invs.find((i) => i.id === r.invoiceId)?.buyerMerchantId);
    const face = BigInt(r.face);
    const price = BigInt(r.price);
    const yieldBps = price === 0n ? 0 : Number(((face - price) * 10_000n) / price);
    const secs = Math.max(r.dueDate - nowS, 1);
    out.push({
      invoiceId: r.invoiceId,
      status: r.status,
      face: fromUnits(face),
      price: fromUnits(price),
      discount: fromUnits(face - price),
      discountBps: r.discountBps,
      reserve: fromUnits(BigInt(r.reserve)),
      reserveBps: r.reserveBps,
      advance: fromUnits(price - BigInt(r.reserve)),
      yieldToDueDate: pct(yieldBps),
      annualisedYield: pct(Math.round((yieldBps * 365 * 86_400) / secs)),
      dueDate: new Date(r.dueDate * 1000).toISOString(),
      fundBy: new Date(r.deadline * 1000).toISOString(),
      merchant: { name: m?.name ?? "Business", reputation: await score(m?.address ?? null) },
      payer: { reputation: await score(buyer?.address ?? null) },
    });
  }
  return out;
}

/** Public. Only what can still be bought: listed, not past its funding deadline, due date still ahead. */
investRoutes.get("/market", async (c) => {
  if (!(await hit(c, "market", 120))) return limited(c);
  const nowS = Math.floor(c.var.now().getTime() / 1000);
  const rows = await c.var.db.select().from(claims).where(and(eq(claims.status, "listed"), gt(claims.deadline, nowS), gt(claims.dueDate, nowS))).orderBy(claims.dueDate).limit(MARKET_LIMIT);
  return c.json({ claims: await publicView(c, rows) });
});

investRoutes.get("/claims/:invoiceId", async (c) => {
  const id = invoiceParam.safeParse(c.req.param("invoiceId"));
  if (!id.success) return fail(c, 404, "not_found", "Claim not found");
  const row = await liveClaim(c.var.db, id.data);
  if (!row || row.status === "pending" || row.status === "sending") return fail(c, 404, "not_found", "Claim not found");
  return c.json((await publicView(c, [row]))[0]);
});

/** What an investor holds (onchain data, so public). */
investRoutes.get("/portfolio/:address", async (c) => {
  const a = address.safeParse(c.req.param("address"));
  if (!a.success) return fail(c, 400, "invalid_request", "Not an address");
  const rows = await c.var.db.select().from(claims).where(and(eq(claims.investor, a.data.toLowerCase()), inArray(claims.status, ["funded", "settled", "defaulted"]))).orderBy(desc(claims.updatedAt));
  return c.json({ claims: await publicView(c, rows) });
});

investRoutes.get("/reputation/:address", async (c) => {
  const a = address.safeParse(c.req.param("address"));
  if (!a.success) return fail(c, 400, "invalid_request", "Not an address");
  if (!(await hit(c, "reputation", 120))) return limited(c);
  try {
    const r = await c.var.chain.reputationOf(a.data as Address);
    return c.json({ address: a.data, score: r.score, onTime: r.onTime, late: r.late, paid: r.onTime + r.late, volume: fromUnits(r.volume) });
  } catch (e) {
    console.error("reputation lookup failed", e);
    return fail(c, 502, "chain_error", "The record could not be read right now. Try again.");
  }
});

// ---- the allowlist (one person, one investor account) --------------------------------------------------------------------

const accountBody = z.strictObject({ account: address });

investRoutes.post("/allow-request", async (c) => {
  const parsed = accountBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await hit(c, "allow-request", 20))) return limited(c);
  const { WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY } = c.env;
  if (!WORLD_APP_ID || !WORLD_RP_ID || !WORLD_RP_SIGNING_KEY) return fail(c, 503, "world_unavailable", "Identity verification is not available right now.");
  const rp_context = await createRpContext({ rpId: WORLD_RP_ID, action: ALLOW_ACTION, signingKey: WORLD_RP_SIGNING_KEY as Hex, now: c.var.now });
  return c.json({ app_id: WORLD_APP_ID, environment: environmentOf(c.env), action: ALLOW_ACTION, account: parsed.data.account, rp_context });
});

investRoutes.post("/allow", async (c) => {
  const parsed = z.strictObject({ account: address, idkitResponse: z.record(z.string(), z.unknown()) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await hit(c, "allow", 10))) return limited(c);
  if (!c.env.WORLD_RP_ID) return fail(c, 503, "world_unavailable", "Identity verification is not available right now.");
  if (!c.env.ATTESTER_PRIVATE_KEY) return fail(c, 503, "attestation_unavailable", "Investor approval is not available right now."); // checked first: a proof is never spent for nothing
  const { db, chain } = c.var;
  const account = parsed.data.account.toLowerCase();

  // With INVESTOR_REQUIRES_KYC=yes (production) investors must be tier 4 (identity documents): the account has to be the onchain
  // account of a business with an approved check. Test environments leave it off, so a World-verified person (the private route)
  // can be allowlisted for demos. Decided before the World proof is checked, so a proof is never spent on an account that cannot be allowed.
  // The attester-signed test path in scripts/ does not come through here and is untouched.
  if (c.env.INVESTOR_REQUIRES_KYC === "yes") {
    const [owner] = await db.select({ id: merchants.id }).from(merchants).where(sql`lower(${merchants.address}) = ${account}`);
    const { tier } = owner ? await merchantTier(db, owner.id, c.var.now()) : { tier: 0 as const };
    const gate = checkInvestor(await loadLimits(db), tier);
    if (refused(gate)) return tierLimitResponse(c, gate, tier);
  }

  const v = await verifyProof(
    { fetch: c.var.fetch, baseUrl: c.env.WORLD_VERIFY_URL ?? "https://developer.world.org", rpId: c.env.WORLD_RP_ID, environment: environmentOf(c.env) },
    parsed.data.idkitResponse,
    ALLOW_ACTION,
  );
  if (!v.ok) {
    await audit(db, { merchantId: null, actor: `investor:${account}`, action: "investor.allow_refused", payload: { kind: v.kind, code: v.kind === "invalid_proof" ? v.code : undefined } });
    if (v.kind === "invalid_proof") return fail(c, 422, v.code, "The verification was not accepted.");
    return fail(c, 502, "world_error", "Identity verification could not be completed right now. Try again.");
  }

  // The unique (action, nullifier) is the anti-replay. The one exception: the same person retrying the same account whose
  // allowlisting did not reach the chain last time (their proof was spent, but they are still not allowed).
  const [byNullifier] = await db.select().from(investorEnrollments).where(and(eq(investorEnrollments.action, ALLOW_ACTION), eq(investorEnrollments.nullifier, v.nullifier)));
  const [byAccount] = await db.select().from(investorEnrollments).where(eq(investorEnrollments.address, account));
  if (byAccount && byAccount.nullifier !== v.nullifier) return fail(c, 409, "account_taken", "This account was verified by someone else.");
  if (byNullifier) {
    if (byNullifier.address !== account || (await chain.investorAllowed(account as Address))) return fail(c, 409, "duplicate", "This person has already verified an investor account.");
  } else {
    const inserted = await db
      .insert(investorEnrollments)
      .values({ address: account, action: ALLOW_ACTION, nullifier: v.nullifier, verifiedAt: c.var.now().toISOString() })
      .onConflictDoNothing()
      .returning({ a: investorEnrollments.address });
    if (inserted.length === 0) return fail(c, 409, "duplicate", "This person has already verified an investor account.");
  }

  try {
    const nowS = Math.floor(c.var.now().getTime() / 1000);
    const expiresAt = BigInt(nowS + ALLOW_VALID_DAYS * 86_400);
    const deadline = BigInt(nowS + ATTESTATION_SECONDS);
    const nonce = await chain.investorNonce(account as Address);
    const signature = await privateKeyToAccount(c.env.ATTESTER_PRIVATE_KEY as Hex).signTypedData({
      domain: investorRegistryDomain(c.env.INVESTOR_REGISTRY_ADDRESS as Address),
      types: allowInvestorTypes,
      primaryType: "AllowInvestor",
      message: { investor: account as Address, expiresAt, deadline, nonce },
    });
    const { txHash } = await chain.allowInvestor({ investor: account as Address, expiresAt, deadline, signature });
    await audit(db, { merchantId: null, actor: `investor:${account}`, action: "investor.allowed", payload: { account, txHash } });
    return c.json({ allowed: true, account, txHash, expiresAt: new Date(Number(expiresAt) * 1000).toISOString() });
  } catch (e) {
    if (e instanceof Rejected) return fail(c, e.reason === "Blocked" ? 403 : 422, e.reason === "Blocked" ? "blocked" : "allow_rejected", "The approval was rejected: " + e.reason);
    console.error("allow failed", e);
    return fail(c, 502, "chain_error", "The approval could not be sent right now. Try again.");
  }
});

// ---- funding ---------------------------------------------------------------------------------------------------------------

/** Looks up a claim that can be bought right now, or answers why not. */
async function buyable(c: Context<AppEnv>, invoiceId: string): Promise<{ row: ClaimRow } | { res: Response }> {
  const row = invoiceParam.safeParse(invoiceId).success ? await liveClaim(c.var.db, invoiceId) : null;
  if (!row || row.status === "pending" || row.status === "sending") return { res: fail(c, 404, "not_found", "Claim not found") };
  if (row.status === "funded" || row.status === "funding" || row.status === "settled" || row.status === "defaulted") return { res: fail(c, 409, "already_funded", "This invoice was already bought.") };
  if (row.status !== "listed") return { res: fail(c, 409, "not_available", "This invoice is not for sale.") };
  if (Math.floor(c.var.now().getTime() / 1000) >= row.deadline - FUND_MARGIN_SECONDS) return { res: fail(c, 409, "expired", "This offer has expired.") };
  return { row };
}

/** Step 1: the digest the investor's passkey signs. Nothing is stored; the signature itself is bound to this invoice. */
investRoutes.post("/claims/:invoiceId/fund-request", async (c) => {
  const parsed = accountBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await hit(c, "fund-request", 60))) return limited(c);
  const got = await buyable(c, c.req.param("invoiceId"));
  if ("res" in got) return got.res;
  const { row } = got;
  if (!(await c.var.chain.investorAllowed(parsed.data.account as Address))) return fail(c, 403, "not_allowed", "This account is not approved to invest.");

  const nowS = Math.floor(c.var.now().getTime() / 1000);
  const salt = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const validBefore = Math.min(nowS + FUND_AUTH_SECONDS, row.deadline);
  const nonce = fundNonce(row.invoiceId as Hex, salt);
  const digest = hashTypedData(
    buildReceiveAuth({ from: parsed.data.account as Address, to: c.env.INVOICE_CLAIM_ADDRESS as Address, value: BigInt(row.price), validAfter: 0n, validBefore: BigInt(validBefore), nonce }),
  );
  return c.json({
    invoiceId: row.invoiceId,
    to: c.env.INVOICE_CLAIM_ADDRESS,
    price: fromUnits(BigInt(row.price)),
    authorization: { from: parsed.data.account, value: row.price, validAfter: "0", validBefore: String(validBefore), nonce, salt },
    challenge: b64urlEncode(Uint8Array.from(Buffer.from(digest.slice(2), "hex"))),
  });
});

const fundBody = z.strictObject({
  account: address,
  salt: word,
  validBefore: z.string().regex(/^\d{1,12}$/),
  signature: z.string().regex(/^0x([0-9a-fA-F]{2}){1,2048}$/),
  accountDetails: z.strictObject({ qx: word, qy: word, salt: word }).optional(),
});

const FUND_REJECTED: Record<string, [409 | 403 | 422, string]> = {
  NotAllowlisted: [403, "not_allowed"],
  NotListed: [409, "not_available"],
  Expired: [409, "expired"],
  InvoiceNotSellable: [409, "not_available"],
};
const TANK_STATUS = { gas_tank_empty: 402, gas_cap_reached: 429, busy: 503, relayer_low: 503, chain_error: 502, tx_reverted: 502, timeout: 504 } as const;

/**
 * Step 2: the investor signed. The signature is the investor's authority (it is bound to this claim's price and nonce);
 * nothing is sent unless the contract would accept it, and the listing merchant's gas tank pays the gas.
 */
investRoutes.post("/claims/:invoiceId/fund", async (c) => {
  const parsed = fundBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const { db, chain } = c.var;
  const now = c.var.now();
  const account = b.account.toLowerCase() as Address;
  if (!(await hit(c, "fund", 20)) || !(await hitRateLimit(db, `fund:account:${account}`, 20, 60, now))) return limited(c);
  const got = await buyable(c, c.req.param("invoiceId"));
  if ("res" in got) return got.res;
  const { row } = got;
  const nowS = Math.floor(now.getTime() / 1000);
  if (BigInt(b.validBefore) <= BigInt(nowS)) return fail(c, 400, "expired", "This signature expired. Start again.");
  if (!(await chain.investorAllowed(account))) return fail(c, 403, "not_allowed", "This account is not approved to invest.");

  const fundData = encodeFunctionData({
    abi: invoiceClaimAbi,
    functionName: "fund",
    args: [row.invoiceId as Hex, { payer: account, validAfter: 0n, validBefore: BigInt(b.validBefore), salt: b.salt as Hex, signature: b.signature as Hex }],
  });
  let call = { to: c.env.INVOICE_CLAIM_ADDRESS as Address, data: fundData };
  let deployed = false;
  if (b.accountDetails && !(await chain.hasCode(account))) {
    const expected = await chain.passkeyAddress(b.accountDetails.qx as Hex, b.accountDetails.qy as Hex, b.accountDetails.salt as Hex);
    if (expected.toLowerCase() !== account) return fail(c, 422, "account_mismatch", "The account details do not match the investor.");
    const createData = encodeFunctionData({ abi: passkeyAccountFactoryAbi, functionName: "createAccount", args: [b.accountDetails.qx as Hex, b.accountDetails.qy as Hex, b.accountDetails.salt as Hex] });
    call = {
      to: MULTICALL3_ADDRESS,
      data: encodeFunctionData({
        abi: multicall3Abi,
        functionName: "aggregate3",
        args: [[{ target: c.env.FACTORY_ADDRESS as Address, allowFailure: false, callData: createData }, { target: c.env.INVOICE_CLAIM_ADDRESS as Address, allowFailure: false, callData: fundData }]],
      }),
    };
    deployed = true;
  }

  // One buyer at a time: whoever flips listed -> funding owns the claim until the transaction is done.
  const lock = await db.update(claims).set({ status: "funding", updatedAt: now.toISOString() }).where(and(eq(claims.id, row.id), eq(claims.status, "listed"))).returning({ id: claims.id });
  if (lock.length === 0) return fail(c, 409, "already_funded", "This invoice was already bought.");
  const unlock = () => db.update(claims).set({ status: "listed", updatedAt: now.toISOString() }).where(and(eq(claims.id, row.id), eq(claims.status, "funding")));

  const sent = await sendFromTank({ db, chain, now }, row.merchantId, call);
  if (!sent.ok) {
    if (sent.code === "timeout") return fail(c, 504, "timeout", "The purchase is taking longer than expected. It may still complete.", { txHash: sent.txHash }); // stays locked until the indexer or the lock timeout decides
    await unlock();
    if (sent.code === "rejected") {
      const [status, code] = FUND_REJECTED[sent.reason] ?? [422, "fund_rejected"];
      return fail(c, status, code, "The purchase was rejected: " + sent.reason);
    }
    return fail(c, TANK_STATUS[sent.code], sent.code === "gas_tank_empty" || sent.code === "gas_cap_reached" ? "seller_unavailable" : sent.code, "The purchase could not be completed. Try again.");
  }
  await db.update(claims).set({ status: "funded", investor: account, fundTxHash: sent.txHash, fundedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(claims.id, row.id));
  await audit(db, { merchantId: row.merchantId, actor: `investor:${account}`, action: "claim.funded", payload: { invoiceId: row.invoiceId, price: row.price, txHash: sent.txHash } });
  return c.json({ status: "funded", txHash: sent.txHash, deployedAccount: deployed, claim: claimView({ ...row, status: "funded", investor: account, fundTxHash: sent.txHash }) });
});
