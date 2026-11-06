import { eq } from "drizzle-orm";
import { hashTypedData, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { MULTICALL3_ADDRESS, allowInvestorTypes, b64urlDecode, buildReceiveAuth, claimDomain, claimTermsTypes, fundNonce, investorRegistryDomain, routerDomain, setHookTypes } from "@stenmont/shared";
import { Rejected, type ClaimLog } from "../src/chain";
import { runClaimIndexer, runDefaults } from "../src/claims";
import { chainCursor, claims, gasTanks, investorEnrollments, invoices, merchants, webhookDeliveries, worldEnrollments } from "../src/db/schema";
import { recordVerification } from "../src/verification/store";
import { fakeAuthenticator } from "./helpers/authenticator";
import { setup } from "./helpers/app";
import { PASSKEY_ADDRESS } from "./helpers/chain";
import { dbOf, seedEndpoint } from "./helpers/fixtures";

const ROUTER = "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929";
const CLAIM = "0x2EB9aaF14A2d729BC3F185A144571fCd23454914";
const REGISTRY = "0x6B8490a893C860888f65ce410b0b287CA1c9B8fa";
const INVESTOR = "0x4444444444444444444444444444444444444444";
const OTHER_INVESTOR = "0x5555555555555555555555555555555555555555";
const INV = `0x${"ab".repeat(32)}`;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const NOW_S = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);
const DAY = 86_400;
const ATTESTER_KEY = generatePrivateKey();
type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const post = (t: T, path: string, body: unknown, headers: Record<string, string> = {}) =>
  t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "1.1.1.1", ...headers } });

const WORLD_ENV = { WORLD_APP_ID: "app_test", WORLD_RP_ID: "rp_test", WORLD_RP_SIGNING_KEY: generatePrivateKey(), WORLD_ENVIRONMENT: "staging", ATTESTER_PRIVATE_KEY: ATTESTER_KEY };
/** A fake World verifier: the next proof carries this nullifier. */
function fakeWorld(nullifier = "0xabc", over?: () => Response) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return over ? over() : Response.json({ success: true, environment: "staging", nullifier, action: "allow-investor" });
  }) as unknown as typeof fetch;
  return { f, calls };
}

/** A signed-in business (passkey sign-up) that is World-verified and owns one open invoice due in 30 days. */
async function business(t: T, opts: { verified?: boolean; invoice?: Partial<typeof invoices.$inferInsert>; tank?: bigint } = {}) {
  const auth = fakeAuthenticator();
  const o = await json(await post(t, "/auth/register/options", { businessName: "Acme" }));
  const reg = await json(await post(t, "/auth/register/verify", { challengeId: o.challengeId, ...auth.attestation(o.options.challenge) }));
  const act = await post(t, "/auth/activate", { challengeId: reg.activation.challengeId, ...auth.assertion(b64urlDecode(reg.activation.challenge)) });
  const cookie = (act.headers.get("set-cookie") ?? "").split(";")[0]!;
  const merchantId = ((await json(act)).merchant as { id: string }).id;
  const db = dbOf(t.db);
  if (opts.verified !== false) await db.insert(worldEnrollments).values({ id: "w1", merchantId, action: "enrol-business-v2", nullifier: "777", verifiedAt: "2026-11-06T00:00:00Z" });
  const stamp = "2026-11-06T10:00:00.000Z";
  await db.insert(invoices).values({
    id: INV, merchantId, number: "INV-1", status: "open", amount: "100000000", metaHash: H(0), customerEmail: "secret@customer.example",
    dueDate: new Date((NOW_S + 30 * DAY) * 1000).toISOString(), createdAt: stamp, updatedAt: stamp, ...opts.invoice,
  });
  await db.insert(gasTanks).values({ merchantId, wbtBalance: (opts.tank ?? 10n ** 17n).toString(), dailyCapWbt: (10n ** 17n).toString(), spentDay: "2026-11-06", perPayerDailyCapUsdt: "1000000000" }).onConflictDoUpdate({
    target: gasTanks.merchantId, set: { wbtBalance: (opts.tank ?? 10n ** 17n).toString(), dailyCapWbt: (10n ** 17n).toString(), spentDay: "2026-11-06" },
  });
  const headers = { cookie, origin: "https://app.test" };
  const request = (body: Record<string, unknown> = {}) => post(t, "/v1/financing/listings", { invoiceId: INV, discountBps: 500, reserveBps: 1000, ...body }, headers);
  const submit = (id: string, body: unknown) => post(t, `/v1/financing/listings/${id}/submit`, body, headers);
  const sign = (r: Record<string, any>) => ({ terms: auth.assertion(b64urlDecode(r.challenges.terms)), hook: auth.assertion(b64urlDecode(r.challenges.hook)) });
  /** request + sign + submit */
  const list = async (body: Record<string, unknown> = {}) => {
    const r = await json(await request(body));
    const res = await submit(r.id, sign(r));
    return { r, res };
  };
  return { auth, db, merchantId, headers, request, submit, sign, list };
}

/** A business with a listed claim and an allowed investor. */
async function listed(over: Parameters<typeof setup>[0] = {}, opts: Parameters<typeof business>[1] = {}) {
  const w = fakeWorld();
  const t = setup(over, WORLD_ENV, { fetch: w.f });
  const b = await business(t, opts);
  const out = await b.list();
  expect(out.res.status).toBe(200);
  t.chain.allowed.add(INVESTOR);
  const fund = (over: Record<string, unknown> = {}, ip = "2.2.2.2") =>
    post(t, `/invest/claims/${INV}/fund`, { account: INVESTOR, salt: H(9), validBefore: String(NOW_S + 1800), signature: "0x1234", ...over }, { "cf-connecting-ip": ip });
  return { t, b, w, fund, listing: out.r };
}

describe("POST /v1/financing/listings (ask for the digests to sign)", () => {
  it("returns the quote and exactly the two digests the contracts will verify", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const res = await b.request();
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ invoiceId: INV, status: "pending", face: "100", price: "95", reserve: "10", advance: "85", discountBps: 500, reserveBps: 1000 });
    const deadline = BigInt(NOW_S + 7 * DAY);
    const terms = hashTypedData({ domain: claimDomain(CLAIM), types: claimTermsTypes, primaryType: "ClaimTerms", message: { invoiceId: INV as Hex, discountBps: 500, reserveBps: 1000, deadline } });
    const hook = hashTypedData({ domain: routerDomain(ROUTER), types: setHookTypes, primaryType: "SetHook", message: { id: INV as Hex, hook: CLAIM, deadline } });
    expect(b64urlDecode(body.challenges.terms)).toEqual(Uint8Array.from(Buffer.from(terms.slice(2), "hex")));
    expect(b64urlDecode(body.challenges.hook)).toEqual(Uint8Array.from(Buffer.from(hook.slice(2), "hex")));
  });
  it("the listing deadline never passes the invoice's due date", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t, { invoice: { dueDate: new Date((NOW_S + 2 * DAY) * 1000).toISOString() } });
    const body = await json(await b.request());
    expect(Date.parse(body.fundBy) / 1000).toBe(NOW_S + 2 * DAY);
  });
  it("asking twice for the same terms gives the same request; different terms replace it", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const a = await json(await b.request());
    const again = await b.request();
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(a.id);
    const other = await json(await b.request({ discountBps: 700 }));
    expect(other.id).not.toBe(a.id);
    expect(await b.db.select().from(claims)).toHaveLength(1);
  });
  it("refuses a business below tier 3 and says how to get there", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t, { verified: false });
    const res = await b.request();
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error.code).toBe("tier_limit");
    expect(body.error.details).toMatchObject({ reason: "financing_tier", currentTier: 0, nextTier: 3 });
    expect(body.error.details.howToReach).toMatch(/World/);
  });
  it("accepts a business at tier 4 through documents alone (no World enrolment)", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t, { verified: false });
    await recordVerification(b.db, { merchantId: b.merchantId, method: "kyc", provider: "mock", reference: "k1", decision: "approved", decidedAt: new Date("2026-11-01T00:00:00Z") });
    expect((await b.request()).status).toBe(201);
  });
  it("refuses an invoice above the tier's financing cap", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t, { invoice: { amount: "5000000001" } }); // 5,000.000001 USDT, one unit over the tier 3 cap
    const res = await b.request();
    expect(res.status).toBe(403);
    expect((await json(res)).error.details).toMatchObject({ reason: "financing_cap", currentTier: 3, nextTier: 4 });
    const ok = await business(setup({}, WORLD_ENV), { invoice: { amount: "5000000000" } });
    expect((await ok.request()).status).toBe(201);
  });
  it("refuses someone else's invoice", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    await b.db.update(invoices).set({ merchantId: "m_someone_else" });
    expect((await b.request()).status).toBe(404);
  });
  it("refuses an invoice that is partly paid, paid, cancelled, refunded, or without a usable due date", async () => {
    for (const over of [{ amountPaid: "1000000", status: "partially_paid" }, { amountPaid: "100000000", status: "paid" }, { status: "cancelled" }, { amountRefunded: "1" }, { dueDate: null }, { dueDate: new Date((NOW_S + 60) * 1000).toISOString() }]) {
      const t = setup({}, WORLD_ENV);
      const b = await business(t, { invoice: over });
      const res = await b.request();
      expect(res.status, JSON.stringify(over)).toBe(422);
      expect((await json(res)).error.code).toBe("invoice_not_sellable");
    }
  });
  it("keeps the terms inside the limits", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    for (const bad of [{ discountBps: 0 }, { discountBps: 3001 }, { reserveBps: 5001 }, { reserveBps: -1 }, { discountBps: 1.5 }, { extra: 1 }]) expect((await b.request(bad)).status).toBe(400);
  });
});

describe("POST /v1/financing/listings/:id/submit", () => {
  it("verifies both passkey taps and offers the invoice on chain, once", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const r = await json(await b.request());
    const body = b.sign(r);
    const res = await b.submit(r.id, body);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ id: r.id, status: "listed", listTxHash: H(8001) });
    expect(t.chain.listed).toHaveLength(1);
    expect(t.chain.listed[0]).toMatchObject({ invoiceId: INV, discountBps: 500, reserveBps: 1000, deadline: BigInt(NOW_S + 7 * DAY) });
    expect(t.chain.listed[0]!.termsSig).toMatch(/^0x[0-9a-f]+$/);
    // submitting again is safe: same answer, nothing sent again
    const again = await b.submit(r.id, body);
    expect(again.status).toBe(200);
    expect(t.chain.listed).toHaveLength(1);
    // and the invoice cannot be offered a second time
    const second = await b.request();
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("already_listed");
  });
  it("refuses a signature from another passkey, or over the wrong digest", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const r = await json(await b.request());
    const stranger = fakeAuthenticator();
    const bad = { terms: stranger.assertion(b64urlDecode(r.challenges.terms)), hook: stranger.assertion(b64urlDecode(r.challenges.hook)) };
    expect((await b.submit(r.id, bad)).status).toBe(401);
    const swapped = { terms: b.auth.assertion(b64urlDecode(r.challenges.hook)), hook: b.auth.assertion(b64urlDecode(r.challenges.terms)) };
    expect((await b.submit(r.id, swapped)).status).toBe(401);
    expect(t.chain.listed).toHaveLength(0);
    expect((await b.submit(r.id, b.sign(r))).status).toBe(200); // the request is still usable
  });
  it("refuses an expired request, an unknown id, and another business's request", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const r = await json(await b.request());
    const signed = b.sign(r);
    expect((await b.submit("cl_unknown", signed)).status).toBe(404);
    await b.db.update(claims).set({ merchantId: "m_someone_else" });
    expect((await b.submit(r.id, signed)).status).toBe(404);
    await b.db.update(claims).set({ merchantId: b.merchantId });
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 3_600_000);
    const res = await b.submit(r.id, signed);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("expired");
    expect(t.chain.listed).toHaveLength(0);
  });
  it("turns a chain rejection into a clear error, sends nothing, and lets the merchant try again", async () => {
    let reject = true;
    const t = setup({ async listClaim() { if (reject) throw new Rejected("InvoiceNotSellable"); return { txHash: H(1) }; } }, WORLD_ENV);
    const b = await business(t);
    const r = await json(await b.request());
    const res = await b.submit(r.id, b.sign(r));
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe("invoice_not_sellable");
    expect((await b.db.select().from(claims))[0]!.status).toBe("pending");
    reject = false;
    expect((await b.submit(r.id, b.sign(r))).status).toBe(200);
  });
  it("refuses if the invoice was paid while the merchant was signing", async () => {
    const t = setup({}, WORLD_ENV);
    const b = await business(t);
    const r = await json(await b.request());
    await b.db.update(invoices).set({ status: "partially_paid", amountPaid: "1000000" });
    const res = await b.submit(r.id, b.sign(r));
    expect(res.status).toBe(422);
    expect(t.chain.listed).toHaveLength(0);
  });
});

describe("the public market", () => {
  it("shows a listed claim with discount, yield, due date and reputation, and nothing private", async () => {
    const { t, b } = await listed();
    t.chain.reputation.set(PASSKEY_ADDRESS.toLowerCase(), { onTime: 9, late: 1, volume: 5_000_000n, score: 90 });
    const res = await t.req("/invest/market");
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    const body = await json(res);
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0]).toMatchObject({
      invoiceId: INV, status: "listed", face: "100", price: "95", discount: "5", discountBps: 500, reserve: "10", advance: "85", yieldToDueDate: "5.26",
      merchant: { name: "Acme", reputation: { score: 90, paid: 10 } }, payer: { reputation: null },
    });
    expect(body.claims[0].dueDate).toBe(new Date((NOW_S + 30 * DAY) * 1000).toISOString());
    expect(Number(body.claims[0].annualisedYield)).toBeGreaterThan(60);
    expect(text).not.toContain("secret@customer.example");
    expect(text).not.toContain(b.merchantId);
  });
  it("hides a funded claim, an expired listing and a request nobody signed", async () => {
    const { t, b, fund } = await listed();
    expect((await json(await t.req("/invest/market"))).claims).toHaveLength(1);
    expect((await fund()).status).toBe(200);
    expect((await json(await t.req("/invest/market"))).claims).toHaveLength(0);
    await b.db.update(claims).set({ status: "listed" }); // pretend it is listed again, but past its deadline
    t.clock.now = new Date((NOW_S + 8 * DAY) * 1000);
    expect((await json(await t.req("/invest/market"))).claims).toHaveLength(0);
    const t2 = setup({}, WORLD_ENV);
    const b2 = await business(t2);
    await b2.request();
    expect((await json(await t2.req("/invest/market"))).claims).toHaveLength(0);
    expect((await t2.req(`/invest/claims/${INV}`)).status).toBe(404);
  });
  it("GET /invest/claims/:invoiceId shows one claim, funded or not, and 404s for unknown ids", async () => {
    const { t } = await listed();
    expect((await json(await t.req(`/invest/claims/${INV}`))).status).toBe("listed");
    expect((await t.req(`/invest/claims/0x${"cd".repeat(32)}`)).status).toBe(404);
    expect((await t.req("/invest/claims/nope")).status).toBe(404);
  });
  it("GET /invest/reputation/:address returns the onchain record", async () => {
    const t = setup();
    t.chain.reputation.set(INVESTOR, { onTime: 3, late: 1, volume: 12_500_000n, score: 75 });
    expect(await json(await t.req(`/invest/reputation/${INVESTOR}`))).toEqual({ address: INVESTOR, score: 75, onTime: 3, late: 1, paid: 4, volume: "12.5" });
    expect(await json(await t.req(`/invest/reputation/${OTHER_INVESTOR}`))).toMatchObject({ score: 0, paid: 0 });
    expect((await t.req("/invest/reputation/xyz")).status).toBe(400);
  });
});

describe("the investor allowlist (World ID)", () => {
  const raw = (t: T, account = INVESTOR, ip = "3.3.3.3") => post(t, "/invest/allow", { account, idkitResponse: { action: "allow-investor", environment: "staging", proof: "p" } }, { "cf-connecting-ip": ip });
  /** Investors need tier 4: the account must belong to a business with an approved document check. */
  const kycBusiness = async (t: T, account: string, decision: "approved" | "rejected" = "approved") => {
    const id = `m_${account.slice(2, 6)}`;
    const db = dbOf(t.db);
    if ((await db.select().from(merchants).where(eq(merchants.id, id))).length === 0) await db.insert(merchants).values({ id, name: "Investor Ltd", address: account, createdAt: "2026-11-01T00:00:00Z" });
    await recordVerification(db, { merchantId: id, method: "kyc", provider: "mock", reference: `ref_${id}_${Math.random()}`, decision, decidedAt: new Date("2026-11-01T00:00:00Z") });
  };
  /** The allowlist call from a document-verified investor (the rest of these tests are about World and the chain). */
  const allow = async (t: T, account = INVESTOR, ip = "3.3.3.3") => {
    const have = await dbOf(t.db).select().from(merchants).where(eq(merchants.id, `m_${account.slice(2, 6)}`));
    if (have.length === 0) await kycBusiness(t, account);
    return raw(t, account, ip);
  };

  it("needs tier 4 when INVESTOR_REQUIRES_KYC is yes: an account with no business, or a business without documents, is refused before any proof is spent", async () => {
    const w = fakeWorld();
    const t = setup({}, { ...WORLD_ENV, INVESTOR_REQUIRES_KYC: "yes" }, { fetch: w.f });
    const none = await raw(t);
    expect(none.status).toBe(403);
    const body = await json(none);
    expect(body.error.code).toBe("tier_limit");
    expect(body.error.details).toMatchObject({ reason: "investor_tier", nextTier: 4 });
    await dbOf(t.db).insert(worldEnrollments).values({ id: "w9", merchantId: "m_4444", action: "enrol-business-v2", nullifier: "9", verifiedAt: "2026-11-01T00:00:00Z" });
    await dbOf(t.db).insert(merchants).values({ id: "m_4444", name: "Investor Ltd", address: INVESTOR, createdAt: "2026-11-01T00:00:00Z" });
    expect((await raw(t)).status).toBe(403); // World alone is tier 3: not enough to invest
    await kycBusiness(t, INVESTOR, "rejected");
    expect((await raw(t)).status).toBe(403);
    expect(w.calls).toHaveLength(0);
    expect(t.chain.allowedSent).toHaveLength(0);
    await kycBusiness(t, INVESTOR);
    expect((await raw(t)).status).toBe(200);
  });
  it("without INVESTOR_REQUIRES_KYC a World-verified person with no business is allowed (the private route, test environments)", async () => {
    const t = setup({}, WORLD_ENV, { fetch: fakeWorld().f });
    expect((await raw(t)).status).toBe(200);
    expect(t.chain.allowedSent).toHaveLength(1);
  });
  it("matches the account case-insensitively", async () => {
    const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    const t = setup({}, WORLD_ENV, { fetch: fakeWorld().f });
    await kycBusiness(t, mixed);
    expect((await raw(t, mixed.toLowerCase())).status).toBe(200);
  });

  it("allow-request returns the IDKit setup for the allow-investor action", async () => {
    const t = setup({}, WORLD_ENV);
    const res = await post(t, "/invest/allow-request", { account: INVESTOR });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ app_id: "app_test", environment: "staging", action: "allow-investor", rp_context: { rp_id: "rp_test" } });
    const bare = setup();
    expect((await post(bare, "/invest/allow-request", { account: INVESTOR })).status).toBe(503);
  });
  it("verifies the proof, signs the attestation and puts the account on the allowlist", async () => {
    const w = fakeWorld();
    const t = setup({}, WORLD_ENV, { fetch: w.f });
    const res = await allow(t);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ allowed: true, account: INVESTOR });
    const sent = t.chain.allowedSent[0]!;
    expect(sent.investor).toBe(INVESTOR);
    const signer = await recoverTypedDataAddress({
      domain: investorRegistryDomain(REGISTRY), types: allowInvestorTypes, primaryType: "AllowInvestor",
      message: { investor: INVESTOR, expiresAt: sent.expiresAt, deadline: sent.deadline, nonce: 0n }, signature: sent.signature,
    });
    expect(signer).toBe(privateKeyToAccount(ATTESTER_KEY).address);
    expect(sent.expiresAt).toBe(BigInt(NOW_S + 180 * DAY));
    expect(await t.chain.investorAllowed(INVESTOR)).toBe(true);
  });
  it("one person, one investor account: a replayed proof or a second account is a 409", async () => {
    const w = fakeWorld();
    const t = setup({}, WORLD_ENV, { fetch: w.f });
    expect((await allow(t)).status).toBe(200);
    const again = await allow(t);
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("duplicate");
    const second = await allow(t, OTHER_INVESTOR);
    expect(second.status).toBe(409);
    expect(t.chain.allowedSent).toHaveLength(1);
    // another person (different nullifier) cannot take over an enrolled account
    const w2 = fakeWorld("0xdef");
    const t2 = setup({}, WORLD_ENV, { fetch: w2.f });
    await dbOf(t2.db).insert(investorEnrollments).values({ address: INVESTOR, action: "allow-investor", nullifier: "1", verifiedAt: "x" });
    expect((await json(await allow(t2))).error.code).toBe("account_taken");
  });
  it("lets the same person retry when the transaction did not reach the chain", async () => {
    let fail = true;
    const w = fakeWorld();
    const t = setup({ async allowInvestor() { if (fail) throw new Error("rpc down"); return { txHash: H(5) }; } }, WORLD_ENV, { fetch: w.f });
    expect((await allow(t)).status).toBe(502);
    fail = false;
    expect((await allow(t)).status).toBe(200);
    expect(await dbOf(t.db).select().from(investorEnrollments)).toHaveLength(1);
  });
  it("refuses a bad proof without enrolling anyone, and does not spend a proof when attestation is unavailable", async () => {
    const bad = fakeWorld("0x1", () => Response.json({ code: "invalid_proof", detail: "no" }, { status: 400 }));
    const t = setup({}, WORLD_ENV, { fetch: bad.f });
    const res = await allow(t);
    expect(res.status).toBe(422);
    expect(await dbOf(t.db).select().from(investorEnrollments)).toHaveLength(0);
    const w = fakeWorld();
    const noKey = setup({}, { ...WORLD_ENV, ATTESTER_PRIVATE_KEY: undefined }, { fetch: w.f });
    expect((await allow(noKey)).status).toBe(503);
    expect(w.calls).toHaveLength(0);
    const down = fakeWorld("0x1", () => new Response("", { status: 500 }));
    expect((await allow(setup({}, WORLD_ENV, { fetch: down.f }))).status).toBe(502);
  });
  it("is rate limited", async () => {
    const w = fakeWorld("0x1", () => Response.json({ code: "invalid_proof" }, { status: 400 }));
    const t = setup({}, WORLD_ENV, { fetch: w.f });
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await allow(t)).status);
    expect(codes.at(-1)).toBe(429);
  });
});

describe("funding", () => {
  it("fund-request returns the digest of the exact authorization the contract will redeem", async () => {
    const { t } = await listed();
    const res = await post(t, `/invest/claims/${INV}/fund-request`, { account: INVESTOR });
    expect(res.status).toBe(200);
    const body = await json(res);
    const { salt, validBefore, nonce } = body.authorization;
    expect(nonce).toBe(fundNonce(INV as Hex, salt));
    const expected = hashTypedData(buildReceiveAuth({ from: INVESTOR, to: CLAIM, value: 95_000_000n, validAfter: 0n, validBefore: BigInt(validBefore), nonce }));
    expect(b64urlDecode(body.challenge)).toEqual(Uint8Array.from(Buffer.from(expected.slice(2), "hex")));
    expect(body.price).toBe("95");
  });
  it("fund-request refuses an account that is not allowlisted, and a claim that is not for sale", async () => {
    const { t } = await listed();
    expect((await post(t, `/invest/claims/${INV}/fund-request`, { account: OTHER_INVESTOR })).status).toBe(403);
    expect((await post(t, `/invest/claims/0x${"cd".repeat(32)}/fund-request`, { account: INVESTOR })).status).toBe(404);
  });
  it("funds the claim, paying the gas from the listing merchant's tank", async () => {
    const { t, b, fund } = await listed();
    const before = (await dbOf(t.db).select().from(gasTanks))[0]!;
    const res = await fund();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "funded", deployedAccount: false });
    const sentTx = t.chain.sent.at(-1)!;
    expect(sentTx.to).toBe(CLAIM);
    const row = (await b.db.select().from(claims))[0]!;
    expect(row).toMatchObject({ status: "funded", investor: INVESTOR });
    const after = (await dbOf(t.db).select().from(gasTanks))[0]!;
    expect(BigInt(after.wbtBalance)).toBeLessThan(BigInt(before.wbtBalance));
  });
  it("funding twice sends only one transaction", async () => {
    const { t, fund } = await listed();
    expect((await fund()).status).toBe(200);
    const sentBefore = t.chain.sent.length;
    const again = await fund({}, "2.2.2.3");
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("already_funded");
    expect(t.chain.sent).toHaveLength(sentBefore);
  });
  it("two investors racing for one claim: exactly one transaction", async () => {
    const { t, fund } = await listed();
    t.chain.allowed.add(OTHER_INVESTOR);
    const results = await Promise.all([fund({}, "6.6.6.1"), fund({ account: OTHER_INVESTOR }, "6.6.6.2"), fund({}, "6.6.6.3")]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(t.chain.sent.filter((s) => s.to === CLAIM)).toHaveLength(1);
  });
  it("refuses an investor who is not allowlisted, or whose approval was revoked, and sends nothing", async () => {
    const { t, fund } = await listed();
    const res = await fund({ account: OTHER_INVESTOR });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("not_allowed");
    t.chain.allowed.delete(INVESTOR); // revoked
    expect((await fund({}, "2.2.2.4")).status).toBe(403);
    expect(t.chain.sent).toHaveLength(0);
    expect((await dbOf(t.db).select().from(claims))[0]!.status).toBe("listed");
  });
  it("refuses a listing past its deadline, and an expired signature", async () => {
    const { t, fund } = await listed();
    expect((await fund({ validBefore: String(NOW_S - 1) })).status).toBe(400);
    t.clock.now = new Date((NOW_S + 7 * DAY - 30) * 1000); // inside the last minute
    const res = await fund({ validBefore: String(NOW_S + 8 * DAY) }, "2.2.2.5");
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("expired");
    expect(t.chain.sent).toHaveLength(0);
  });
  it("answers a contract rejection clearly, sends nothing and leaves the claim for sale", async () => {
    const { t, fund } = await listed({ async estimateGas() { throw new Rejected("NotAllowlisted"); } });
    const res = await fund();
    expect(res.status).toBe(403);
    expect(t.chain.sent).toHaveLength(0);
    expect((await dbOf(t.db).select().from(claims))[0]!.status).toBe("listed");
    const bad = await listed({ async estimateGas() { throw new Rejected("FiatToken: authorization is used"); } });
    expect((await bad.fund()).status).toBe(422);
  });
  it("does not use up the claim when the merchant's gas tank is empty", async () => {
    const { t, fund } = await listed({}, { tank: 0n });
    const res = await fund();
    expect(res.status).toBe(402);
    expect(t.chain.sent).toHaveLength(0);
    expect((await dbOf(t.db).select().from(claims))[0]!.status).toBe("listed");
  });
  it("deploys the investor's passkey account in the same transaction when it does not exist yet", async () => {
    const { t, fund } = await listed({ async hasCode() { return false; } });
    t.chain.allowed.add(PASSKEY_ADDRESS.toLowerCase());
    const details = { qx: H(1), qy: H(2), salt: H(3) };
    const bad = await fund({ account: PASSKEY_ADDRESS, accountDetails: { ...details } }, "7.7.7.1");
    expect(bad.status).toBe(200);
    expect((await json(bad)).deployedAccount).toBe(true);
    expect(t.chain.sent.at(-1)!.to).toBe(MULTICALL3_ADDRESS);
  });
  it("refuses account details that do not match the investor", async () => {
    const { t, fund } = await listed({ async hasCode() { return false; } });
    const res = await fund({ accountDetails: { qx: H(1), qy: H(2), salt: H(3) } });
    expect(res.status).toBe(422);
    expect(t.chain.sent).toHaveLength(0);
  });
  it("is rate limited", async () => {
    const { t, fund } = await listed({ async estimateGas() { throw new Rejected("FiatToken: x"); } });
    const codes = [];
    for (let i = 0; i < 22; i++) codes.push((await fund({}, "8.8.8.8")).status);
    expect(codes.at(-1)).toBe(429);
    expect(t.chain.sent).toHaveLength(0);
  });
});

describe("the claim indexer", () => {
  const log = (eventName: string, args: Record<string, unknown>, n: number): ClaimLog => ({ eventName, args, transactionHash: H(n), logIndex: 0, blockNumber: BigInt(n) }) as ClaimLog;
  // the fake chain is always at block 1000: reset the cursor so every run reads the (growing) log list again, like a re-run over the same blocks
  const run = async (t: T) => {
    await dbOf(t.db).delete(chainCursor);
    return runClaimIndexer(t.env, dbOf(t.db), t.chain, t.clock.now);
  };
  const deliveries = async (t: T, type: string) => (await dbOf(t.db).select().from(webhookDeliveries)).filter((d) => d.type === type);

  it("follows the chain: funded, then settled, with one webhook each, and survives being run over the same blocks again", async () => {
    const { t, b } = await listed();
    await seedEndpoint(t.db, { merchantId: b.merchantId });
    t.chain.claimLogs.push(
      log("ClaimFunded", { invoiceId: INV, investor: INVESTOR, price: 95_000_000n, advance: 85_000_000n }, 10),
      log("Transfer", { from: "0x0000000000000000000000000000000000000000", to: INVESTOR, tokenId: BigInt(INV) }, 10),
    );
    expect(await run(t)).toMatchObject({ status: "ok", logs: 2 });
    let row = (await b.db.select().from(claims))[0]!;
    expect(row).toMatchObject({ status: "funded", investor: INVESTOR, fundTxHash: H(10) });
    expect(await deliveries(t, "claim.funded")).toHaveLength(1);

    t.chain.claimLogs.push(log("Transfer", { from: INVESTOR, to: OTHER_INVESTOR, tokenId: BigInt(INV) }, 11), log("ClaimSettled", { invoiceId: INV, reserveReleased: 10_000_000n }, 12));
    await run(t);
    row = (await b.db.select().from(claims))[0]!;
    expect(row).toMatchObject({ status: "settled", investor: OTHER_INVESTOR, closeTxHash: H(12) });
    expect(await deliveries(t, "claim.settled")).toHaveLength(1);

    // run over the same blocks again from scratch: nothing changes, nothing is re-sent
    await run(t);
    row = (await b.db.select().from(claims))[0]!;
    expect(row).toMatchObject({ status: "settled", investor: OTHER_INVESTOR });
    expect(await deliveries(t, "claim.funded")).toHaveLength(1);
    expect(await deliveries(t, "claim.settled")).toHaveLength(1);
  });
  it("marks a listing listed when the API lost the reply, records a default once, and cancellations quietly", async () => {
    const { t, b } = await listed();
    await seedEndpoint(t.db, { merchantId: b.merchantId });
    await b.db.update(claims).set({ status: "sending", listTxHash: null });
    t.chain.claimLogs.push(log("ClaimListed", { invoiceId: INV, merchant: PASSKEY_ADDRESS, face: 100_000_000n, price: 95_000_000n, reserve: 10_000_000n, dueDate: 1n }, 20));
    await run(t);
    expect((await b.db.select().from(claims))[0]).toMatchObject({ status: "listed", listTxHash: H(20) });
    t.chain.claimLogs.push(
      log("ClaimFunded", { invoiceId: INV, investor: INVESTOR, price: 95_000_000n, advance: 85_000_000n }, 21),
      log("ClaimDefaulted", { invoiceId: INV, holder: INVESTOR, reserveToHolder: 10_000_000n }, 22),
    );
    await run(t);
    expect((await b.db.select().from(claims))[0]!.status).toBe("defaulted");
    await run(t);
    expect(await deliveries(t, "claim.defaulted")).toHaveLength(1);
    // a status never moves backwards, and cancelling a settled/defaulted claim does nothing
    t.chain.claimLogs.push(log("ClaimCancelled", { invoiceId: INV }, 23));
    await run(t);
    expect((await b.db.select().from(claims))[0]!.status).toBe("defaulted");
  });
  it("ignores claims it does not know, and releases a stale funding lock", async () => {
    const { t, b } = await listed();
    t.chain.claimLogs.push(log("ClaimFunded", { invoiceId: H(99), investor: INVESTOR, price: 1n, advance: 1n }, 30));
    await run(t);
    expect((await b.db.select().from(claims))[0]!.status).toBe("listed");
    await b.db.update(claims).set({ status: "funding", updatedAt: new Date(t.clock.now.getTime() - 3_600_000).toISOString() });
    await run(t);
    expect((await b.db.select().from(claims))[0]!.status).toBe("listed"); // the lock is released; the Funded event was for another invoice
  });
  it("does nothing when the claim contract is not configured", async () => {
    const t = setup({}, { INVOICE_CLAIM_ADDRESS: "" });
    expect(await runClaimIndexer(t.env, dbOf(t.db), t.chain)).toEqual({ status: "idle" });
  });
});

describe("defaults", () => {
  const fundedClaim = async (over: Parameters<typeof setup>[0] = {}, dueAgoDays = 8) => {
    const x = await listed(over);
    await seedEndpoint(x.t.db, { merchantId: x.b.merchantId });
    await x.b.db.update(claims).set({ status: "funded", investor: INVESTOR, dueDate: NOW_S - dueAgoDays * DAY });
    return x;
  };
  const run = (x: { t: T }) => runDefaults(x.t.env, dbOf(x.t.db), x.t.chain, x.t.clock.now);
  const markDefaultSends = (x: { t: T }) => x.t.chain.sent.filter((s) => s.to === CLAIM);

  it("marks a funded claim more than 7 days past due as defaulted, exactly once", async () => {
    const x = await fundedClaim();
    x.t.chain.claimStates.set(INV, { status: "defaulted", received: 0n, toHolder: 10_000_000n, fundBy: 0n });
    expect(await run(x)).toEqual({ defaulted: 1 });
    expect(markDefaultSends(x)).toHaveLength(1);
    expect((await x.b.db.select().from(claims))[0]).toMatchObject({ status: "defaulted" });
    expect((await dbOf(x.t.db).select().from(webhookDeliveries)).filter((d) => d.type === "claim.defaulted")).toHaveLength(1);
    expect(await run(x)).toEqual({ defaulted: 0 });
    expect(markDefaultSends(x)).toHaveLength(1);
  });
  it("leaves a claim alone before the grace period ends, and one that is not funded", async () => {
    const x = await fundedClaim({}, 6);
    await run(x);
    expect(markDefaultSends(x)).toHaveLength(0);
    await x.b.db.update(claims).set({ status: "listed", dueDate: NOW_S - 30 * DAY });
    await run(x);
    expect(markDefaultSends(x)).toHaveLength(0);
  });
  it("two overlapping runs send once", async () => {
    const x = await fundedClaim();
    x.t.chain.claimStates.set(INV, { status: "defaulted", received: 0n, toHolder: 0n, fundBy: 0n });
    await Promise.all([run(x), run(x)]);
    expect(markDefaultSends(x)).toHaveLength(1);
  });
  it("a problem on our side leaves the claim funded for the next run; a settled claim is synced, not defaulted", async () => {
    const empty = await fundedClaim();
    await dbOf(empty.t.db).update(gasTanks).set({ wbtBalance: "0" });
    await run(empty);
    expect(markDefaultSends(empty)).toHaveLength(0);
    expect((await empty.b.db.select().from(claims))[0]!.status).toBe("funded");

    const settled = await fundedClaim({ async estimateGas() { throw new Rejected("NotFunded"); } });
    settled.t.chain.claimStates.set(INV, { status: "settled", received: 100_000_000n, toHolder: 100_000_000n, fundBy: 0n });
    expect(await run(settled)).toEqual({ defaulted: 0 });
    expect((await settled.b.db.select().from(claims))[0]!.status).toBe("settled");
    expect(markDefaultSends(settled)).toHaveLength(0);
  });
});

describe("step times (for the merchant's financing timeline)", () => {
  const NOW_ISO = new Date(NOW_S * 1000).toISOString();
  it("records when the listing, the purchase and the close happened", async () => {
    const { t, b, fund } = await listed();
    expect((await b.db.select().from(claims))[0]).toMatchObject({ listedAt: NOW_ISO, fundedAt: null, closedAt: null, showInvoiceNumber: 0 });
    expect((await fund()).status).toBe(200);
    expect((await b.db.select().from(claims))[0]).toMatchObject({ listedAt: NOW_ISO, fundedAt: NOW_ISO, closedAt: null });
    t.chain.claimLogs.push({ eventName: "ClaimSettled", args: { invoiceId: INV, reserveReleased: 10_000_000n }, transactionHash: H(12), logIndex: 0, blockNumber: 12n } as ClaimLog);
    await dbOf(t.db).delete(chainCursor);
    await runClaimIndexer(t.env, dbOf(t.db), t.chain, new Date((NOW_S + 60) * 1000));
    expect((await b.db.select().from(claims))[0]).toMatchObject({ status: "settled", fundedAt: NOW_ISO, closedAt: new Date((NOW_S + 60) * 1000).toISOString() });
  });
  it("stamps a purchase the API only learned about from the chain, and a default", async () => {
    const { t, b } = await listed();
    t.chain.claimLogs.push({ eventName: "ClaimFunded", args: { invoiceId: INV, investor: INVESTOR, price: 95_000_000n, advance: 85_000_000n }, transactionHash: H(10), logIndex: 0, blockNumber: 10n } as ClaimLog);
    await dbOf(t.db).delete(chainCursor);
    await runClaimIndexer(t.env, dbOf(t.db), t.chain, t.clock.now);
    expect((await b.db.select().from(claims))[0]).toMatchObject({ status: "funded", fundedAt: NOW_ISO });
    await b.db.update(claims).set({ dueDate: NOW_S - 8 * DAY });
    t.chain.claimStates.set(INV, { status: "defaulted", received: 0n, toHolder: 10_000_000n, fundBy: 0n });
    await runDefaults(t.env, dbOf(t.db), t.chain, t.clock.now);
    expect((await b.db.select().from(claims))[0]).toMatchObject({ status: "defaulted", closedAt: NOW_ISO });
  });
});
