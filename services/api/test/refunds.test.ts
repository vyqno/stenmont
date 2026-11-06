import { hashTypedData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, buildReceiveAuth, refundApprovalTypes, refundNonce, refundOpHash, routerDomain } from "@stenmont/shared";
import { createApproval } from "../src/world/approvals";
import { d1ApprovalRepo } from "../src/world/d1";
import { Rejected } from "../src/chain";
import { invoices, payments, refunds } from "../src/db/schema";
import { fakeAuthenticator } from "./helpers/authenticator";
import { setup } from "./helpers/app";
import { PASSKEY_ADDRESS } from "./helpers/chain";
import { dbOf } from "./helpers/fixtures";

const ROUTER = "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929";
const PAYER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const INV = `0x${"ab".repeat(32)}`;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const post = (t: T, path: string, body: unknown, headers: Record<string, string> = {}) =>
  t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "1.1.1.1", ...headers } });

/** A signed-in business (passkey sign-up, so the merchant account is the passkey account) with one paid invoice. */
async function business(t: T, paid = 10_000_000n) {
  const auth = fakeAuthenticator();
  const opts = await json(await post(t, "/auth/register/options", { businessName: "Acme" }));
  const reg = await json(await post(t, "/auth/register/verify", { challengeId: opts.challengeId, ...auth.attestation(opts.options.challenge) }));
  const act = await post(t, "/auth/activate", { challengeId: reg.activation.challengeId, ...auth.assertion(b64urlDecode(reg.activation.challenge)) });
  const cookie = (act.headers.get("set-cookie") ?? "").split(";")[0]!;
  const merchantId = ((await json(act)).merchant as { id: string }).id;
  const db = dbOf(t.db);
  const now = "2026-11-06T10:00:00.000Z";
  await db.insert(invoices).values({ id: INV, merchantId, number: "INV-1", status: "paid", amount: paid.toString(), amountPaid: paid.toString(), metaHash: H(0), createdAt: now, updatedAt: now });
  await db.insert(payments).values({ id: "p1", invoiceId: INV, payer: PAYER, value: paid.toString(), txHash: H(1), logIndex: 0, blockNumber: 1, createdAt: now });
  const headers = { cookie, origin: "https://app.test" };
  const request = (body: unknown) => post(t, "/v1/refunds", body, headers);
  const submit = (id: string, over: Record<string, unknown>) => post(t, `/v1/refunds/${id}/submit`, over, headers);
  return { auth, db, merchantId, headers, request, submit };
}
const sign = (auth: ReturnType<typeof fakeAuthenticator>, challenge: string, over = {}) => auth.assertion(b64urlDecode(challenge), over);

describe("POST /v1/refunds (ask for the digest to sign)", () => {
  it("returns exactly the token authorisation the router will redeem, for the payer's full refundable amount by default", async () => {
    const t = setup();
    const b = await business(t);
    const res = await b.request({ invoiceId: INV });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ invoiceId: INV, to: PAYER, amount: "10", status: "pending" });
    const { salt, validBefore } = body.authorization;
    const expected = hashTypedData(
      buildReceiveAuth({ from: PASSKEY_ADDRESS, to: ROUTER, value: 10_000_000n, validAfter: 0n, validBefore: BigInt(validBefore), nonce: refundNonce(INV as `0x${string}`, PAYER, salt) }),
    );
    expect(b64urlDecode(body.challenge)).toEqual(Uint8Array.from(Buffer.from(expected.slice(2), "hex")));
  });
  it("supports partial refunds and counts earlier refunds against what is left", async () => {
    const t = setup();
    const b = await business(t);
    expect((await json(await b.request({ invoiceId: INV, amount: "4.00" }))).amount).toBe("4");
    await b.db.insert(refunds).values({ id: "r0", invoiceId: INV, toAddress: PAYER, value: "7000000", txHash: H(5), logIndex: 0, blockNumber: 5, createdAt: "2026-11-06T11:00:00.000Z" });
    expect((await b.request({ invoiceId: INV, amount: "3.01" })).status).toBe(422); // only 3.00 left
    expect((await json(await b.request({ invoiceId: INV }))).amount).toBe("3");
  });
  it("refuses what cannot be refunded: unknown invoice, someone who never paid, nothing paid, bad amounts", async () => {
    const t = setup();
    const b = await business(t);
    expect((await b.request({ invoiceId: `0x${"cd".repeat(32)}` })).status).toBe(404);
    expect((await b.request({ invoiceId: INV, to: OTHER })).status).toBe(422);
    for (const amount of ["0", "-1", "abc", "1.0000001"]) expect((await b.request({ invoiceId: INV, amount })).status).toBe(400);
    const t2 = setup();
    const b2 = await business(t2, 0n);
    await b2.db.delete(payments);
    expect((await b2.request({ invoiceId: INV })).status).toBe(422);
  });
  it("never touches another business's invoice", async () => {
    const t = setup();
    const b = await business(t);
    await b.db.update(invoices).set({ merchantId: "m_someone_else" });
    expect((await b.request({ invoiceId: INV })).status).toBe(404);
  });
  it("sends refunds above the approval threshold to the human-approval step instead of failing at the contract", async () => {
    const t = setup();
    const b = await business(t, 150_000_000n);
    const res = await b.request({ invoiceId: INV });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("approval_required");
    expect((await b.request({ invoiceId: INV, amount: "100" })).status).toBe(201); // exactly the threshold is allowed
  });
  it("needs a signed-in business", async () => {
    const t = setup();
    await business(t);
    expect((await post(t, "/v1/refunds", { invoiceId: INV })).status).toBe(401);
  });
});

describe("POST /v1/refunds/:id/submit (the passkey signs, we relay)", () => {
  it("sends the refund to the router with the passkey's signature and records the transaction", async () => {
    const t = setup();
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV, amount: "2.50" }));
    const res = await b.submit(r.id, sign(b.auth, r.challenge));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ status: "submitted", txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(t.chain.refundsSent).toHaveLength(1);
    expect(t.chain.refundsSent[0]).toMatchObject({
      invoiceId: INV,
      value: 2_500_000n,
      to: PAYER,
      merchant: PASSKEY_ADDRESS,
      validAfter: 0n,
      salt: r.authorization.salt,
      validBefore: BigInt(r.authorization.validBefore),
    });
    expect(t.chain.refundsSent[0]!.signature).toMatch(/^0x[0-9a-f]+$/);
    const audit = await t.db.prepare("select action from audit_log where action = 'refund.submitted'").all();
    expect(audit.results).toHaveLength(1);
  });
  it("works only once per request", async () => {
    const t = setup();
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV }));
    expect((await b.submit(r.id, sign(b.auth, r.challenge))).status).toBe(200);
    expect((await b.submit(r.id, sign(b.auth, r.challenge))).status).toBe(409);
    expect(t.chain.refundsSent).toHaveLength(1);
  });
  it("refuses a signature from the wrong passkey, the wrong digest or without user verification, and sends nothing", async () => {
    const t = setup();
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV }));
    expect((await b.submit(r.id, sign(fakeAuthenticator(), r.challenge))).status).toBe(401);
    expect((await b.submit(r.id, sign(b.auth, r.challenge, { challengeOverride: new Uint8Array(32) }))).status).toBe(401);
    expect((await b.submit(r.id, sign(b.auth, r.challenge, { uv: false }))).status).toBe(401);
    expect(t.chain.refundsSent).toHaveLength(0);
  });
  it("cannot be submitted by someone else's session, or after it expires", async () => {
    const t = setup();
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV }));
    t.clock.now = new Date(t.clock.now.getTime() + 61 * 60_000);
    expect((await b.submit(r.id, sign(b.auth, r.challenge))).status).toBe(400);
    expect((await b.submit("nope", sign(b.auth, r.challenge))).status).toBe(404);
  });
  it("turns a contract rejection into a clear answer, and a chain outage into a retryable error", async () => {
    let mode: "reject" | "down" | "ok" = "reject";
    const t = setup({
      async refund() {
        if (mode === "reject") throw new Rejected("RefundTooLarge");
        if (mode === "down") throw new Error("rpc down");
        return { txHash: H(77) as `0x${string}` };
      },
    });
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV }));
    const rejected = await b.submit(r.id, sign(b.auth, r.challenge));
    expect(rejected.status).toBe(422);
    expect((await json(rejected)).error.code).toBe("refund_too_large");
    mode = "down";
    expect((await b.submit(r.id, sign(b.auth, r.challenge))).status).toBe(502);
    mode = "ok";
    expect((await b.submit(r.id, sign(b.auth, r.challenge))).status).toBe(200); // the same request can be retried
  });
});

describe("refunds above the threshold need a World approval, then the platform's attester signs for the router", () => {
  const ATTESTER_KEY = generatePrivateKey();
  const BIG = 150_000_000n;
  async function bigBusiness() {
    const t = setup({}, { ATTESTER_PRIVATE_KEY: ATTESTER_KEY });
    const b = await business(t, BIG);
    return { t, b };
  }
  async function approve(t: T, merchantId: string, params: Record<string, unknown>) {
    const repo = d1ApprovalRepo(dbOf(t.db));
    const row = await createApproval(repo, { merchantId, operation: "refund", params }, { now: t.clock.now, newId: () => crypto.randomUUID(), newNonce: () => "n" });
    await repo.transition(row.id, "pending", { status: "approved", worldSub: "human_1", authTime: Math.floor(t.clock.now.getTime() / 1000) });
    return row.id;
  }

  it("says exactly what must be approved", async () => {
    const { b } = await bigBusiness();
    const res = await b.request({ invoiceId: INV });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("approval_required");
    expect(body.error.details.approvalParams).toEqual({ invoiceId: INV, amount: "150", to: PAYER });
  });
  it("lets the refund through once, only for what was approved", async () => {
    const { t, b } = await bigBusiness();
    await approve(t, b.merchantId, { invoiceId: INV, amount: "140", to: PAYER }); // approved for a different amount
    expect((await b.request({ invoiceId: INV })).status).toBe(409);
    await approve(t, b.merchantId, { invoiceId: INV, amount: "150", to: PAYER });
    const ok = await b.request({ invoiceId: INV });
    expect(ok.status).toBe(201);
    expect((await json(ok)).approved).toBe(true);
    expect((await b.request({ invoiceId: INV })).status).toBe(409); // the approval was used up
  });
  it("sends the router the attester's signature over exactly this refund", async () => {
    const { t, b } = await bigBusiness();
    await approve(t, b.merchantId, { invoiceId: INV, amount: "150", to: PAYER });
    const r = await json(await b.request({ invoiceId: INV }));
    const res = await b.submit(r.id, sign(b.auth, r.challenge));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const sent = t.chain.refundsSent[0]!;
    expect(sent.approval).toBeDefined();
    const opHash = refundOpHash(INV as `0x${string}`, BIG, PAYER as `0x${string}`, sent.salt);
    const signer = await recoverTypedDataAddress({
      domain: routerDomain(ROUTER),
      types: refundApprovalTypes,
      primaryType: "RefundApproval",
      message: { opHash, deadline: sent.approval!.deadline },
      signature: sent.approval!.signature,
    });
    expect(signer).toBe(privateKeyToAccount(ATTESTER_KEY).address);
  });
  it("small refunds carry no attester signature, and a missing attester key stops a big one before anything is sent", async () => {
    const t = setup({}, { ATTESTER_PRIVATE_KEY: ATTESTER_KEY });
    const b = await business(t);
    const r = await json(await b.request({ invoiceId: INV, amount: "2" }));
    await b.submit(r.id, sign(b.auth, r.challenge));
    expect(t.chain.refundsSent[0]!.approval).toBeUndefined();

    const noKey = setup();
    const nb = await business(noKey, BIG);
    await approve(noKey, nb.merchantId, { invoiceId: INV, amount: "150", to: PAYER });
    const asked = await json(await nb.request({ invoiceId: INV }));
    const res = await nb.submit(asked.id, sign(nb.auth, asked.challenge));
    expect(res.status).toBe(503);
    expect(noKey.chain.refundsSent).toHaveLength(0);
  });
});
