import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { approvals, invoices, sessions, worldEnrollments } from "../src/db/schema";
import { sha256Hex } from "../src/lib/crypto";
import { seedMerchant, setup } from "./helpers/app";
import { dbOf } from "./helpers/fixtures";
import { rsaKey, signJwt } from "./world/helpers";
import { generatePrivateKey } from "viem/accounts";

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const WORLD_ENV = {
  WORLD_APP_ID: "app_test",
  WORLD_RP_ID: "rp_test",
  WORLD_RP_SIGNING_KEY: generatePrivateKey(),
  WORLD_OIDC_CLIENT_ID: "client_1",
  WORLD_OIDC_CLIENT_SECRET: "secret_1",
  WORLD_ENVIRONMENT: "staging",
  WORLD_OIDC_ISSUER: "https://auth.world.org",
};
// The app runs on the test clock (not the real one), so every token time is derived from it.
const CLOCK_S = Math.floor(Date.parse("2026-11-06T12:00:00Z") / 1000);
let key: Awaited<ReturnType<typeof rsaKey>>;
beforeAll(async () => (key = await rsaKey()));

/** A fake World: the verifier, the token endpoint and the key set. */
function fakeWorld(over: { verify?: () => Response; claims?: (nonce: string) => object } = {}) {
  const calls: { url: string; body?: any; auth?: string | null }[] = [];
  let lastCode = "";
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body && String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : init?.body, auth: new Headers(init?.headers).get("authorization") });
    if (u.includes("/api/v4/verify/")) return (over.verify ?? (() => Response.json({ success: true, environment: "staging", nullifier: "0xabc", action: "enrol-business" })))();
    if (u.endsWith("/.well-known/jwks.json")) return Response.json(key.jwks);
    if (u.endsWith("/api/v1/token")) {
      const form = new URLSearchParams(String(init?.body));
      lastCode = form.get("code") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (challengeByCode.get(lastCode) !== challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const nonce = nonceByCode.get(lastCode) ?? "";
      const t = CLOCK_S;
      const claims = over.claims ? over.claims(nonce) : { iss: "https://auth.world.org", aud: "client_1", sub: "human_1", exp: t + 600, auth_time: t - 10, nonce };
      return Response.json({ id_token: await signJwt(key.priv, claims), token_type: "Bearer" });
    }
    return new Response("unexpected " + u, { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const nonceByCode = new Map<string, string>();
const challengeByCode = new Map<string, string>();

async function world(over: Parameters<typeof fakeWorld>[0] = {}, envOver = {}) {
  const w = fakeWorld(over);
  const t = setup({}, { ...WORLD_ENV, ...envOver }, { fetch: w.f });
  const key1 = await seedMerchant(t.db);
  const key2 = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const post = (path: string, body: unknown, k = key1) => t.req(path, { method: "POST", key: k, idem: crypto.randomUUID(), body: JSON.stringify(body) });
  const cookieFor = async (merchantId: string) => {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await dbOf(t.db).insert(sessions).values({ tokenHash: await sha256Hex(token), merchantId, passkeyId: "p", createdAt: t.clock.now.toISOString(), expiresAt: new Date(t.clock.now.getTime() + 3_600_000).toISOString() });
    return `__Secure-stenmont_test=${token}`;
  };
  return { t, w, key1, key2, post, cookieFor };
}

describe("POST /v1/world/rp-signature", () => {
  it("signs a request context for the enrolment action and says which app and environment to use", async () => {
    const { post } = await world();
    const res = await post("/v1/world/rp-signature", { action: "enrol-business" });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b).toMatchObject({ app_id: "app_test", environment: "staging", rp_context: { rp_id: "rp_test" } });
    expect(b.rp_context.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(JSON.stringify(b)).not.toContain(WORLD_ENV.WORLD_RP_SIGNING_KEY);
  });
  it("only signs known actions, needs a signed-in business, and is unavailable when World is not configured", async () => {
    const { t, post } = await world();
    expect((await post("/v1/world/rp-signature", { action: "anything" })).status).toBe(400);
    expect((await t.req("/v1/world/rp-signature", { method: "POST", body: JSON.stringify({ action: "enrol-business" }) })).status).toBe(401);
    const bare = await world({}, { WORLD_RP_SIGNING_KEY: undefined });
    expect((await bare.post("/v1/world/rp-signature", { action: "enrol-business" })).status).toBe(503);
  });
});

describe("POST /v1/world/verify (one person, one business)", () => {
  const proof = { protocol_version: "4.0", nonce: "n", action: "enrol-business", environment: "staging", responses: [{ identifier: "proof_of_human", nullifier: "0xabc" }] };
  it("checks the proof with World, enrols the business, and stores the nullifier as a number", async () => {
    const { t, w, post } = await world();
    const res = await post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ enrolled: true });
    expect(w.calls.find((c) => c.url.includes("/api/v4/verify/rp_test"))?.body).toMatchObject({ environment: "staging" });
    expect((await dbOf(t.db).select().from(worldEnrollments))[0]).toMatchObject({ merchantId: "m_1", action: "enrol-business", nullifier: BigInt("0xabc").toString() });
  });
  it("shows the status of the signed-in business", async () => {
    const { t, post, key1, key2 } = await world();
    await post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof });
    expect((await json(await t.req("/v1/world/status", { key: key1 }))).enrolled).toBe(true);
    expect((await json(await t.req("/v1/world/status", { key: key2 }))).enrolled).toBe(false);
  });
  it("refuses the same person enrolling a second business, and a business enrolling twice", async () => {
    const { post, key2 } = await world();
    expect((await post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof })).status).toBe(200);
    const again = await post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof });
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("already_enrolled");
    const second = await post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof }, key2);
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("duplicate");
  });
  it("a rejected proof is 422, an unreachable World is 502, and neither stores anything", async () => {
    const bad = await world({ verify: () => Response.json({ code: "invalid_proof", detail: "bad" }, { status: 400 }) });
    expect((await bad.post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof })).status).toBe(422);
    const down = await world({ verify: () => new Response("x", { status: 503 }) });
    expect((await down.post("/v1/world/verify", { action: "enrol-business", idkitResponse: proof })).status).toBe(502);
    expect(await dbOf(down.t.db).select().from(worldEnrollments)).toHaveLength(0);
    const wrongEnv = await world();
    expect((await wrongEnv.post("/v1/world/verify", { action: "enrol-business", idkitResponse: { ...proof, environment: "production" } })).status).toBe(422);
  });
});

describe("invoices between the same human", () => {
  it("are allowed between different people, refuse an unknown buyer, and one person cannot be enrolled twice", async () => {
    const { t, key1, post } = await world();
    const db = dbOf(t.db);
    const stamp = t.clock.now.toISOString();
    await db.insert(worldEnrollments).values([
      { id: "e1", merchantId: "m_1", action: "enrol-business", nullifier: "5", verifiedAt: stamp },
      { id: "e2", merchantId: "m_2", action: "enrol-business", nullifier: "6", verifiedAt: stamp },
    ]);
    const make = (buyer: string, k = key1) => t.req("/v1/invoices", { method: "POST", key: k, idem: crypto.randomUUID(), body: JSON.stringify({ amount: "5", buyerMerchantId: buyer }) });
    expect((await make("m_2")).status).toBe(201);
    // The same person cannot be behind two enrolled businesses at all: the database refuses a second row for one nullifier,
    // so the same-human check on invoices is a second line of defence (its logic is tested in test/world).
    await expect(db.insert(worldEnrollments).values({ id: "e3", merchantId: "m_3", action: "enrol-business", nullifier: "5", verifiedAt: stamp })).rejects.toThrow();
    expect((await make("m_nobody")).status).toBe(404);
    expect(await db.select().from(invoices).where(eq(invoices.buyerMerchantId, "m_2"))).toHaveLength(1);
    void post;
  });
});

describe("step-up approvals through World Agent Pass", () => {
  const refundParams = { invoiceId: `0x${"ab".repeat(32)}`, amount: "150", to: "0x2222222222222222222222222222222222222222" };
  async function started(operation = "refund") {
    const x = await world();
    const cookie = await x.cookieFor("m_1");
    const res = await x.post("/v1/approvals", { operation, params: refundParams });
    const b = await json(res);
    return { ...x, cookie, approval: b, res };
  }
  const callback = (x: Awaited<ReturnType<typeof started>>, q: Record<string, string>, cookie = x.cookie) =>
    x.t.req(`/auth/world/callback?${new URLSearchParams(q)}`, { headers: { cookie } });
  const rememberNonce = async (x: Awaited<ReturnType<typeof started>>, code: string) => {
    const [row] = await dbOf(x.t.db).select().from(approvals).where(eq(approvals.id, x.approval.id));
    nonceByCode.set(code, row!.nonce);
    const res = await x.t.req(`/v1/approvals/${x.approval.id}`, { key: x.key1 });
    void res;
    const url = new URL(x.approval.authorizeUrl);
    challengeByCode.set(code, url.searchParams.get("code_challenge")!);
  };

  it("creates an approval and returns the World sign-in address with a fresh-login request and no secret in it", async () => {
    const x = await started();
    expect(x.res.status).toBe(201);
    const url = new URL(x.approval.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://auth.world.org/api/v1/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "client_1", scope: "openid", state: x.approval.id, prompt: "login", redirect_uri: "https://api.test/auth/world/callback" });
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/); // unpadded base64url of a SHA-256 digest
    expect(x.approval.authorizeUrl).not.toContain("secret_1");
    expect((await json(await x.t.req(`/v1/approvals/${x.approval.id}`, { key: x.key1 }))).status).toBe("pending");
    expect((await x.t.req(`/v1/approvals/${x.approval.id}`, { key: x.key2 })).status).toBe(404); // another business cannot see it
  });
  it("approves when World confirms a fresh sign-in for this approval, and sends the person back to the app", async () => {
    const x = await started();
    await rememberNonce(x, "code_ok");
    const res = await callback(x, { code: "code_ok", state: x.approval.id });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://app.test/dashboard/invoices?approval=${x.approval.id}&result=approved`);
    expect((await json(await x.t.req(`/v1/approvals/${x.approval.id}`, { key: x.key1 }))).status).toBe("approved");
    const token = x.w.calls.find((c) => c.url.endsWith("/api/v1/token"));
    expect(token?.auth).toBe(`Basic ${btoa("client_1:secret_1")}`);
  });
  it("denies when the person cancels at World, the token is stale, or it was made for another request", async () => {
    const cancelled = await started();
    const c1 = await callback(cancelled, { error: "access_denied", state: cancelled.approval.id });
    expect(c1.headers.get("location")).toContain("result=denied");
    expect((await json(await cancelled.t.req(`/v1/approvals/${cancelled.approval.id}`, { key: cancelled.key1 }))).status).toBe("denied");

    const stale = await world({ claims: (nonce) => ({ iss: "https://auth.world.org", aud: "client_1", sub: "h", exp: CLOCK_S + 600, auth_time: CLOCK_S - 3_600, nonce }) });
    const sx = { ...stale, cookie: await stale.cookieFor("m_1"), approval: await json(await stale.post("/v1/approvals", { operation: "refund", params: refundParams })) } as Awaited<ReturnType<typeof started>>;
    await rememberNonce(sx, "code_stale");
    expect((await callback(sx, { code: "code_stale", state: sx.approval.id })).headers.get("location")).toContain("result=denied");

    const wrong = await world({ claims: () => ({ iss: "https://auth.world.org", aud: "client_1", sub: "h", exp: CLOCK_S + 600, auth_time: CLOCK_S, nonce: "someone-elses" }) });
    const wx = { ...wrong, cookie: await wrong.cookieFor("m_1"), approval: await json(await wrong.post("/v1/approvals", { operation: "refund", params: refundParams })) } as Awaited<ReturnType<typeof started>>;
    await rememberNonce(wx, "code_wrong");
    expect((await callback(wx, { code: "code_wrong", state: wx.approval.id })).headers.get("location")).toContain("result=denied");
  });
  it("returns agent-limit approvals and cancellations to Identity", async () => {
    const x = await started("agent_limit");
    await rememberNonce(x, "agent_ok");
    expect((await callback(x, { code: "agent_ok", state: x.approval.id })).headers.get("location")).toBe(`https://app.test/dashboard/identity?approval=${x.approval.id}&result=approved`);
    const cancelled = await started("agent_limit");
    expect((await callback(cancelled, { error: "access_denied", state: cancelled.approval.id })).headers.get("location")).toBe(`https://app.test/dashboard/identity?approval=${cancelled.approval.id}&result=denied`);
  });
  it("only the signed-in business that asked can complete it, and a used callback does nothing the second time", async () => {
    const x = await started();
    await rememberNonce(x, "code_once");
    const other = await x.cookieFor("m_2");
    expect((await callback(x, { code: "code_once", state: x.approval.id }, other)).status).toBe(403);
    expect((await x.t.req(`/auth/world/callback?code=c&state=${x.approval.id}`)).status).toBe(401); // no session at all
    expect((await callback(x, { code: "code_once", state: x.approval.id })).headers.get("location")).toContain("result=approved");
    const replay = await callback(x, { code: "code_once", state: x.approval.id });
    expect(replay.headers.get("location")).toContain("result=denied"); // already used: reported, not re-approved
    expect((await callback(x, { code: "c", state: "nope" })).status).toBe(400);
  });
  it("validates what can be asked for", async () => {
    const x = await started();
    expect((await x.post("/v1/approvals", { operation: "launch_missiles", params: {} })).status).toBe(400);
    expect((await x.post("/v1/approvals", { operation: "refund" })).status).toBe(400);
  });
});
