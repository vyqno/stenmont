import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { apiKeys, passkeys, refundRequests, refunds, subscriptions } from "../src/db/schema";
import { runRenewals } from "../src/renewals";
import { baseEnv, seedMerchant, setup } from "./helpers/app";
import { fakeAuthenticator } from "./helpers/authenticator";
import { dbOf, fakeQueue } from "./helpers/fixtures";
import { b64urlDecode } from "@stenmont/shared";

const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe("idempotency keys are tied to the request", () => {
  it("replays the stored answer for the same request, and refuses the same key on a different body or route", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const send = (body: unknown, path = "/v1/invoices", idem = "k1") => t.req(path, { method: "POST", key, idem, body: JSON.stringify(body) });
    const first = await send({ amount: "5", number: "A" });
    expect(first.status).toBe(201);
    const again = await send({ amount: "5", number: "A" });
    expect(again.status).toBe(201);
    expect((await json(again)).id).toBe((await json(first)).id);
    const different = await send({ amount: "6", number: "B" });
    expect(different.status).toBe(422);
    expect((await json(different)).error.code).toBe("idempotency_key_reuse");
    const elsewhere = await send({ amount: "5", periodSeconds: 60, maxCharges: 1 }, "/v1/subscriptions");
    expect(elsewhere.status).toBe(422);
    expect(t.chain.calls).toHaveLength(1);
  });
});

describe("API keys can be made and revoked", () => {
  it("creates a key that works and is shown once, and revokes one so it stops working", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const made = await t.req("/v1/api-keys", { method: "POST", key, idem: "a", body: "{}" });
    expect(made.status).toBe(201);
    const body = await json(made);
    expect(body.key).toMatch(/^sk_test_[0-9a-f]{32}$/);
    expect((await t.req("/v1/me", { key: body.key })).status).toBe(200);
    const list = await json(await t.req("/v1/api-keys", { key }));
    expect(JSON.stringify(list)).not.toContain(body.key);
    const revoke = await t.req(`/v1/api-keys/${body.id}/revoke`, { method: "POST", key, idem: "b", body: "{}" });
    expect(revoke.status).toBe(200);
    expect((await t.req("/v1/me", { key: body.key })).status).toBe(401);
  });
  it("will not revoke the last working key, and not another business's key", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    void other;
    const mine = (await json(await t.req("/v1/api-keys", { key }))).data[0];
    const last = await t.req(`/v1/api-keys/${mine.id}/revoke`, { method: "POST", key, idem: "c", body: "{}" });
    expect(last.status).toBe(409);
    expect((await json(last)).error.code).toBe("last_key");
    const theirs = (await dbOf(t.db).select().from(apiKeys).where(eq(apiKeys.merchantId, "m_2")))[0]!;
    expect((await t.req(`/v1/api-keys/${theirs.id}/revoke`, { method: "POST", key, idem: "d", body: "{}" })).status).toBe(404);
  });
});

describe("webhook endpoints are capped per business", () => {
  it("allows 10 and refuses the 11th", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    for (let i = 0; i < 10; i++) {
      expect((await t.req("/v1/webhook-endpoints", { method: "POST", key, idem: `w${i}`, body: JSON.stringify({ url: `https://shop${i}.example/hook` }) })).status).toBe(201);
    }
    const res = await t.req("/v1/webhook-endpoints", { method: "POST", key, idem: "w11", body: JSON.stringify({ url: "https://shop11.example/hook" }) });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("too_many_endpoints");
  });
});

describe("invoice creation is limited, because each invoice costs the platform gas", () => {
  it("allows a burst of 60 a minute from one business and then asks it to wait", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    let last = 201;
    for (let i = 0; i < 61; i++) last = (await t.req("/v1/invoices", { method: "POST", key, idem: `i${i}`, body: JSON.stringify({ amount: "1" }) })).status;
    expect(last).toBe(429);
    expect(t.chain.calls).toHaveLength(60);
  });
});

describe("a passkey can belong to one business only", () => {
  it("refuses to register the same public key twice, even under a new credential id", async () => {
    const t = setup();
    const a = fakeAuthenticator();
    const post = (path: string, body: unknown) => t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "2.2.2.2" } });
    const reg = async (auth: ReturnType<typeof fakeAuthenticator>, credentialId?: string) => {
      const opts = await json(await post("/auth/register/options", { businessName: "Acme" }));
      const att = auth.attestation(opts.options.challenge);
      return post("/auth/register/verify", { challengeId: opts.challengeId, ...att, ...(credentialId ? { credentialId } : {}) });
    };
    expect((await reg(a)).status).toBe(201);
    const clone = await reg(a, "AAAAAAAAAAAAAAAAAAAAAA"); // same key, different credential id
    expect(clone.status).toBe(409);
    expect(await dbOf(t.db).select().from(passkeys)).toHaveLength(1);
    void b64urlDecode;
  });
});

describe("renewals do not step on each other", () => {
  it("a subscription being charged by one run is skipped by an overlapping run", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const db = dbOf(t.db);
    const now = new Date("2026-11-06T12:00:00Z");
    const nowS = Math.floor(now.getTime() / 1000);
    await db.insert(subscriptions).values({ id: `0x${"ab".repeat(32)}`, merchantId: "m_1", amount: "1000000", periodSeconds: 60, maxCharges: 3, startAt: nowS, payer: "0x2222222222222222222222222222222222222222", status: "active", charges: 0, nextChargeAt: nowS - 1, failedAttempts: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    void key;
    const env = { ...baseEnv(t.db), WEBHOOKS: fakeQueue() } as unknown as ReturnType<typeof baseEnv>;
    // fund a tank so charging can run
    await t.db.prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt) values ('m_1', '100000000000000000', '100000000000000000', '0', '2026-11-06', '1000000000')").run();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = { ...t.chain, waitForReceipt: async () => (await gate, { status: "success" as const, gasUsed: 1n, effectiveGasPrice: 1n }), subscriptionState: async () => ({ nextCharge: BigInt(nowS + 60), charges: 1, status: "active" as const }) };
    const first = runRenewals(env, db, slow, now);
    await new Promise((r) => setTimeout(r, 30));
    const second = await runRenewals(env, db, slow, now); // overlaps with the first, which is still waiting for its receipt
    expect(second).toEqual({ charged: 0, failed: 0 });
    release();
    expect(await first).toEqual({ charged: 1, failed: 0 });
    expect(t.chain.sent.length + (slow as any).sent.length).toBeGreaterThan(0);
  });
});

describe("large refunds need approval even when split", () => {
  it("counts earlier refunds and pending requests toward the 100 USDT threshold", async () => {
    // a signed-in passkey business is needed to ask for refunds
    const t = setup();
    const auth = fakeAuthenticator();
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "3.3.3.3", ...headers } });
    const opts = await json(await post("/auth/register/options", { businessName: "Acme" }));
    const reg = await json(await post("/auth/register/verify", { challengeId: opts.challengeId, ...auth.attestation(opts.options.challenge) }));
    const act = await post("/auth/activate", { challengeId: reg.activation.challengeId, ...auth.assertion(b64urlDecode(reg.activation.challenge)) });
    const cookie = (act.headers.get("set-cookie") ?? "").split(";")[0]!;
    const merchantId = ((await json(act)).merchant as { id: string }).id;
    const db = dbOf(t.db);
    const INV = `0x${"ab".repeat(32)}`;
    const PAYER = "0x2222222222222222222222222222222222222222";
    const stamp = "2026-11-06T10:00:00.000Z";
    await t.db.prepare("insert into invoices (id, merchant_id, number, status, amount, amount_paid, meta_hash, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)").bind(INV, merchantId, "INV-1", "paid", "500000000", "500000000", `0x${"0".repeat(64)}`, stamp, stamp).run();
    await t.db.prepare("insert into payments (id, invoice_id, payer, value, tx_hash, log_index, block_number, created_at) values (?,?,?,?,?,?,?,?)").bind("p1", INV, PAYER, "500000000", `0x${"1".repeat(64)}`, 0, 1, stamp).run();
    const headers = { cookie, origin: "https://app.test" };
    const ask = (amount: string) => post("/v1/refunds", { invoiceId: INV, amount }, headers);
    expect((await ask("60")).status).toBe(201); // 60 pending
    const second = await ask("60"); // 60 + 60 = 120 > 100
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("approval_required");
    void refunds; void refundRequests;
  });
});
