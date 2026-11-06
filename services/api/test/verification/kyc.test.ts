import { describe, expect, it } from "vitest";
import { verificationRecords } from "../../src/db/schema";
import { signWebhook } from "../../src/lib/signature";
import { seedMerchant, setup } from "../helpers/app";
import { dbOf } from "../helpers/fixtures";

const SECRET = "whsec_kyc_test";
type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as any;
const unix = (t: T) => Math.floor(t.clock.now.getTime() / 1000);
const start = (t: T, key: string) => t.req("/v1/verification/kyc/start", { method: "POST", key, body: "{}" });
const event = (reference: string, over: Record<string, unknown> = {}) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type: "check.completed", reference, result: "green", occurredAt: "2026-11-06T12:00:00.000Z", ...over });
async function hook(t: T, body: unknown, over: { secret?: string; at?: number; header?: string; provider?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const sig = over.header ?? (await signWebhook(over.secret ?? SECRET, raw, over.at ?? unix(t)));
  return t.req(`/webhooks/kyc/${over.provider ?? "mock"}`, { method: "POST", body: raw, headers: { "x-kyc-signature": sig, "content-type": "application/json" } });
}
const tierOf = async (t: T, key: string) => (await json(await t.req("/v1/verification", { key }))).tier;

async function started() {
  const t = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET });
  const key = await seedMerchant(t.db);
  const res = await start(t, key);
  expect(res.status).toBe(201);
  const body = await json(res);
  return { t, key, reference: body.reference as string, body };
}

describe("POST /v1/verification/kyc/start", () => {
  it("opens a pending check and stores only a reference", async () => {
    const { t, key, body } = await started();
    expect(body).toMatchObject({ provider: "mock", sandbox: true });
    expect(body.reference).toMatch(/^mock_/);
    expect(body.url).toMatch(/^https:\/\/app\.test\/dashboard\/verification/);
    const rows = await dbOf(t.db).select().from(verificationRecords);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchantId: "m_1", method: "kyc", decision: "pending", provider: "mock", reference: body.reference });
    expect(await tierOf(t, key)).toBe(0);
  });
  it("is unavailable when no provider is configured", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await start(t, key)).status).toBe(503);
  });
  it("is not offered by the sandbox provider in production", async () => {
    const t = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET, ENVIRONMENT: "production" });
    const key = await seedMerchant(t.db);
    expect((await start(t, key)).status).toBe(503);
    expect((await hook(t, event("mock_x"))).status).toBe(404);
  });
  it("needs sign-in and is rate limited", async () => {
    const t = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET });
    expect((await t.req("/v1/verification/kyc/start", { method: "POST", body: "{}" })).status).toBe(401);
    const key = await seedMerchant(t.db);
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await start(t, key)).status);
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes[6]).toBe(429);
  });
});

describe("POST /webhooks/kyc/:provider", () => {
  it("an approved decision raises the tier to 4 and writes an audit row", async () => {
    const { t, key, reference } = await started();
    const res = await hook(t, event(reference));
    expect(res.status).toBe(200);
    expect(await tierOf(t, key)).toBe(4);
    const [row] = await dbOf(t.db).select().from(verificationRecords);
    expect(row).toMatchObject({ decision: "approved" });
    expect(row!.expiresAt).toBeTruthy();
    const audit = (await t.db.prepare("select action, payload from audit_log where action = 'verification.kyc_decision'").all()).results as { payload: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.payload)).toMatchObject({ tierBefore: 0, tierAfter: 4, decision: "approved", provider: "mock" });
  });
  it("a rejected decision leaves the tier alone, and a later rejection takes tier 4 away", async () => {
    const { t, key, reference } = await started();
    expect((await hook(t, event(reference, { result: "red" }))).status).toBe(200);
    expect(await tierOf(t, key)).toBe(0);
    expect((await hook(t, event(reference, { occurredAt: "2026-11-06T12:01:00.000Z" }))).status).toBe(200);
    expect(await tierOf(t, key)).toBe(4);
    expect((await hook(t, event(reference, { result: "red", occurredAt: "2026-11-06T12:02:00.000Z" }))).status).toBe(200);
    expect(await tierOf(t, key)).toBe(0);
  });
  it("a review result stays pending", async () => {
    const { t, key, reference } = await started();
    await hook(t, event(reference, { result: "review" }));
    expect(await tierOf(t, key)).toBe(0);
  });
  it("refuses a bad signature, a wrong secret, a stale timestamp and a missing header", async () => {
    const { t, key, reference } = await started();
    const e = event(reference);
    expect((await hook(t, e, { secret: "wrong" })).status).toBe(401);
    expect((await hook(t, e, { at: unix(t) - 301 })).status).toBe(401);
    expect((await hook(t, e, { header: "" })).status).toBe(401);
    const raw = JSON.stringify(e);
    const sig = await signWebhook(SECRET, raw, unix(t));
    const tampered = await t.req("/webhooks/kyc/mock", { method: "POST", body: raw.replace("green", "red"), headers: { "x-kyc-signature": sig } });
    expect(tampered.status).toBe(401);
    expect(await tierOf(t, key)).toBe(0);
  });
  it("is idempotent: the same event twice changes nothing the second time", async () => {
    const { t, reference } = await started();
    const e = event(reference);
    expect((await json(await hook(t, e))).duplicate).toBeUndefined();
    const again = await hook(t, e);
    expect(again.status).toBe(200);
    expect((await json(again)).duplicate).toBe(true);
    const n = (await t.db.prepare("select count(*) as n from audit_log where action = 'verification.kyc_decision'").first()) as { n: number };
    expect(n.n).toBe(1);
  });
  it("replay protection: an old rejection cannot undo a newer approval, even with a fresh event id", async () => {
    const { t, key, reference } = await started();
    await hook(t, event(reference, { occurredAt: "2026-11-06T12:05:00.000Z" }));
    const stale = await hook(t, event(reference, { result: "red", occurredAt: "2026-11-06T12:01:00.000Z" }));
    expect(stale.status).toBe(200);
    expect((await json(stale)).ignored).toBe("stale");
    expect(await tierOf(t, key)).toBe(4);
  });
  it("ignores an unknown reference without revealing anything, and refuses unknown providers and bad bodies", async () => {
    const { t, key } = await started();
    const res = await hook(t, event("mock_does_not_exist"));
    expect(res.status).toBe(200);
    expect((await json(res)).ignored).toBe("unknown_reference");
    expect(await tierOf(t, key)).toBe(0);
    expect((await hook(t, event("x"), { provider: "acme" })).status).toBe(404);
    expect((await hook(t, "not json")).status).toBe(400);
    expect((await hook(t, { id: "e", type: "check.completed" })).status).toBe(400);
  });
  it("does not let one business's reference move another business", async () => {
    const t = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET });
    const a = await seedMerchant(t.db, "m_1", "A", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "B", `sk_test_${"b".repeat(32)}`);
    const ref = (await json(await start(t, a))).reference;
    await hook(t, event(ref));
    expect(await tierOf(t, a)).toBe(4);
    expect(await tierOf(t, b)).toBe(0);
  });
});

describe("GET /v1/verification and the sandbox decision", () => {
  it("reports tier, next step and limits", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const body = await json(await t.req("/v1/verification", { key }));
    expect(body).toMatchObject({ tier: 0, nextStep: { tier: 1, route: "email" } });
    expect(body.limits[0]).toMatchObject({ perInvoice: "100", dailyVolume: "500", financing: false, investor: false });
    expect(body.limits).toHaveLength(5);
    expect(JSON.stringify(body)).not.toMatch(/mock_/); // references never go back out
  });
  it("sandbox-decision completes your own pending check outside production only", async () => {
    const { t, key } = await started();
    const res = await t.req("/v1/verification/kyc/sandbox-decision", { method: "POST", key, body: JSON.stringify({ result: "green" }) });
    expect(res.status).toBe(200);
    expect(await tierOf(t, key)).toBe(4);
    const prod = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET, ENVIRONMENT: "production" });
    const k2 = await seedMerchant(prod.db);
    expect((await prod.req("/v1/verification/kyc/sandbox-decision", { method: "POST", key: k2, body: JSON.stringify({ result: "green" }) })).status).toBe(404);
  });
  it("sandbox-decision needs a pending check first", async () => {
    const t = setup({}, { KYC_MOCK_WEBHOOK_SECRET: SECRET });
    const key = await seedMerchant(t.db);
    expect((await t.req("/v1/verification/kyc/sandbox-decision", { method: "POST", key, body: JSON.stringify({ result: "green" }) })).status).toBe(409);
  });
});
