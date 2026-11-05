import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, parseDerSignature, routerDomain, setCreatorTypes } from "@stenmont/shared";
import { fakeAuthenticator } from "./helpers/authenticator";
import { setup } from "./helpers/app";
import { PASSKEY_ADDRESS, RELAYER_ADDRESS } from "./helpers/chain";

const ROUTER = "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929";
type T = ReturnType<typeof setup>;
type Auth = ReturnType<typeof fakeAuthenticator>;
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const post = (t: T, path: string, body: unknown, headers: Record<string, string> = {}) =>
  t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "1.1.1.1", ...headers } });

async function register(t: T, auth: Auth, name = "Acme Studio") {
  const opts = await json(await post(t, "/auth/register/options", { businessName: name }));
  const att = auth.attestation(opts.options.challenge);
  const res = await post(t, "/auth/register/verify", { challengeId: opts.challengeId, ...att });
  return { opts, res, body: await json(res) };
}
async function activate(t: T, auth: Auth, reg: Record<string, any>) {
  const a = auth.assertion(b64urlDecode(reg.activation.challenge));
  return post(t, "/auth/activate", { challengeId: reg.activation.challengeId, ...a });
}
async function signup(t: T, auth: Auth = fakeAuthenticator()) {
  const { body } = await register(t, auth);
  const res = await activate(t, auth, body);
  return { auth, reg: body, res, done: await json(res) };
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
async function login(t: T, auth: Auth, over: Record<string, unknown> = {}) {
  const o = await json(await post(t, "/auth/login/options", {}));
  const a = auth.assertion(b64urlDecode(o.options.challenge));
  return post(t, "/auth/login/verify", { challengeId: o.challengeId, ...a, ...over });
}

describe("passkey registration", () => {
  it("offers passkey-only options: one algorithm, a discoverable credential, user verification required", async () => {
    const t = setup();
    const { options } = await json(await post(t, "/auth/register/options", { businessName: "Acme Studio" }));
    expect(options.rp).toEqual({ name: "Stenmont", id: "app.test" });
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.attestation).toBe("none");
    expect(b64urlDecode(options.challenge)).toHaveLength(32);
  });
  it("validates the business name and rate-limits by IP", async () => {
    const t = setup();
    for (const bad of ["", "x", "a".repeat(81), "<script>", 5]) expect((await post(t, "/auth/register/options", { businessName: bad })).status).toBe(400);
    for (let i = 0; i < 10; i++) await post(t, "/auth/register/options", { businessName: "Acme" });
    const res = await post(t, "/auth/register/options", { businessName: "Acme" });
    expect(res.status).toBe(429);
  });
  it("creates a pending business whose account address comes from the passkey", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    const { res, body } = await register(t, auth);
    expect(res.status).toBe(201);
    expect(body.account).toBe(PASSKEY_ADDRESS);
    const m = (await t.db.prepare("select * from merchants").first()) as Record<string, any>;
    expect(m).toMatchObject({ name: "Acme Studio", address: PASSKEY_ADDRESS, payout_address: PASSKEY_ADDRESS, status: "pending" });
    expect(await t.db.prepare("select count(*) as n from api_keys").first()).toMatchObject({ n: 0 }); // no key until activated
    expect(await t.db.prepare("select count(*) as n from passkeys").first()).toMatchObject({ n: 1 });
  });
  it("asks the new passkey to authorise invoice creation, with exactly the digest the contract will check", async () => {
    const t = setup();
    const { body } = await register(t, fakeAuthenticator());
    const { deadline } = body.activation;
    const expected = hashTypedData({
      domain: routerDomain(ROUTER),
      types: setCreatorTypes,
      primaryType: "SetCreator",
      message: { merchant: PASSKEY_ADDRESS, creator: RELAYER_ADDRESS, allowed: true, deadline: BigInt(deadline), nonce: 0n },
    });
    expect(b64urlEncode(Uint8Array.from(Buffer.from(expected.slice(2), "hex")))).toBe(body.activation.challenge);
  });
  it("rejects a wrong challenge, wrong origin, wrong ceremony type, and a challenge used twice", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    const { challengeId, options } = await json(await post(t, "/auth/register/options", { businessName: "Acme" }));
    for (const over of [{ challenge: b64urlEncode(new Uint8Array(32)) }, { origin: "https://evil.example" }, { type: "webauthn.get" }]) {
      const res = await post(t, "/auth/register/verify", { challengeId, ...auth.attestation(options.challenge, over) });
      expect(res.status).toBe(400);
    }
    expect((await post(t, "/auth/register/verify", { challengeId, ...auth.attestation(options.challenge) })).status).toBe(201);
    expect((await post(t, "/auth/register/verify", { challengeId, ...auth.attestation(options.challenge) })).status).toBe(400);
  });
  it("rejects an expired challenge and an already registered passkey", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    const { challengeId, options } = await json(await post(t, "/auth/register/options", { businessName: "Acme" }));
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    expect((await post(t, "/auth/register/verify", { challengeId, ...auth.attestation(options.challenge) })).status).toBe(400);
    t.clock.now = new Date("2026-11-06T12:00:00Z");
    await register(t, auth);
    const again = await register(t, auth);
    expect(again.res.status).toBe(409);
  });
});

describe("activation (the second prompt)", () => {
  it("proves possession, creates the account and authorises invoice creation in one transaction, then issues the API key once", async () => {
    const t = setup();
    const { reg, res, done } = await signup(t);
    expect(res.status).toBe(200);
    expect(done.apiKey).toMatch(/^sk_test_[0-9a-f]{32}$/);
    expect(t.chain.activations).toHaveLength(1);
    const a = t.chain.activations[0]!;
    expect(a).toMatchObject({ account: PASSKEY_ADDRESS, creator: RELAYER_ADDRESS, deadline: BigInt(reg.activation.deadline) });
    expect(a.signature).toMatch(/^0x[0-9a-f]+$/); // the six WebAuthn fields, ABI-encoded flat
    expect(((await t.db.prepare("select status from merchants").first()) as { status: string }).status).toBe("active");
    // the issued key works
    expect((await t.req("/v1/me", { key: done.apiKey })).status).toBe(200);
  });
  it("sets a secure session cookie and gives a new merchant a starter gas tank outside production", async () => {
    const t = setup({}, { COOKIE_DOMAIN: ".stenmont.com" });
    const { res } = await signup(t);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Secure-stenmont_test=[0-9a-f]{64};/);
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Domain=.stenmont.com"]) expect(cookie).toContain(part);
    const tank = (await t.db.prepare("select wbt_balance from gas_tanks").first()) as { wbt_balance: string };
    expect(BigInt(tank.wbt_balance)).toBeGreaterThan(0n);
    const prod = setup({}, { ENVIRONMENT: "production" });
    await signup(prod);
    expect(await prod.db.prepare("select count(*) as n from gas_tanks").first()).toMatchObject({ n: 0 });
  });
  it("refuses a signature from the wrong challenge, the wrong key, or without user verification, and sends nothing", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    const { body } = await register(t, auth);
    const challenge = b64urlDecode(body.activation.challenge);
    const send = (a: Record<string, unknown>) => post(t, "/auth/activate", { challengeId: body.activation.challengeId, ...a });
    expect((await send(auth.assertion(challenge, { challengeOverride: new Uint8Array(32) }))).status).toBe(401);
    expect((await send(fakeAuthenticator().assertion(challenge))).status).toBe(401); // another passkey
    expect((await send(auth.assertion(challenge, { uv: false }))).status).toBe(401);
    expect((await send({ ...auth.assertion(challenge), credentialId: "unknown" })).status).toBe(401);
    expect(t.chain.activations).toHaveLength(0);
    expect(((await t.db.prepare("select status from merchants").first()) as { status: string }).status).toBe("pending");
  });
  it("a chain failure leaves the business pending and the attempt can be retried", async () => {
    let fail = true;
    const t = setup({
      async activateMerchant() {
        if (fail) throw new Error("rpc down");
        return { txHash: `0x${"7".repeat(64)}` as `0x${string}` };
      },
    });
    const auth = fakeAuthenticator();
    const { body } = await register(t, auth);
    const first = await activate(t, auth, body);
    expect(first.status).toBe(502);
    expect(((await t.db.prepare("select status from merchants").first()) as { status: string }).status).toBe("pending");
    fail = false;
    expect((await activate(t, auth, body)).status).toBe(200);
  });
  it("cannot be run twice and unknown or expired challenges are refused", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    const { body } = await register(t, auth);
    expect((await activate(t, auth, body)).status).toBe(200);
    expect((await activate(t, auth, body)).status).toBe(400);
    expect((await post(t, "/auth/activate", { challengeId: "nope", ...auth.assertion(new Uint8Array(32)) })).status).toBe(400);
    const t2 = setup();
    const a2 = fakeAuthenticator();
    const { body: b2 } = await register(t2, a2);
    t2.clock.now = new Date(t2.clock.now.getTime() + 61 * 60_000);
    expect((await activate(t2, a2, b2)).status).toBe(400);
  });
  it("limits activations per IP, because each one costs the platform some gas", async () => {
    const t = setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signup(t)).res.status);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});

describe("signing in with a passkey", () => {
  it("signs a returning business in without a username, a password or a code", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const res = await login(t, auth);
    expect(res.status).toBe(200);
    expect((await json(res)).merchant).toMatchObject({ name: "Acme Studio" });
    const cookie = cookieOf(res);
    const me = await t.req("/auth/session", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await json(me)).merchant.name).toBe("Acme Studio");
  });
  it("offers a discoverable login: no credential list, user verification required", async () => {
    const t = setup();
    const { options } = await json(await post(t, "/auth/login/options", {}));
    expect(options).toMatchObject({ rpId: "app.test", userVerification: "required" });
    expect(options.allowCredentials).toBeUndefined();
  });
  it("rejects another person's passkey, a wrong challenge, a missing user verification and an unknown credential", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const o = async () => json(await post(t, "/auth/login/options", {}));
    let x = await o();
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...fakeAuthenticator().assertion(b64urlDecode(x.options.challenge)) })).status).toBe(401);
    x = await o();
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...auth.assertion(b64urlDecode(x.options.challenge), { challengeOverride: new Uint8Array(32) }) })).status).toBe(401);
    x = await o();
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...auth.assertion(b64urlDecode(x.options.challenge), { uv: false }) })).status).toBe(401);
    x = await o();
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...auth.assertion(b64urlDecode(x.options.challenge)), credentialId: "nope" })).status).toBe(401);
  });
  it("a sign-in challenge works once, and a replayed or cloned authenticator (counter not increasing) is refused", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const x = await json(await post(t, "/auth/login/options", {}));
    const a = auth.assertion(b64urlDecode(x.options.challenge), { counter: 50 });
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...a })).status).toBe(200);
    expect((await post(t, "/auth/login/verify", { challengeId: x.challengeId, ...a })).status).toBe(400); // challenge consumed
    const y = await json(await post(t, "/auth/login/options", {}));
    const replay = auth.assertion(b64urlDecode(y.options.challenge), { counter: 50 }); // same counter as before
    expect((await post(t, "/auth/login/verify", { challengeId: y.challengeId, ...replay })).status).toBe(401);
  });
  it("refuses a business that has not finished activation", async () => {
    const t = setup();
    const auth = fakeAuthenticator();
    await register(t, auth);
    const res = await login(t, auth);
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("not_activated");
  });
  it("logs out, and expired sessions stop working", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const cookie = cookieOf(await login(t, auth));
    const out = await t.req("/auth/logout", { method: "POST", headers: { cookie, origin: "https://app.test" } });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await t.req("/auth/session", { headers: { cookie } })).status).toBe(401);

    const again = cookieOf(await login(t, auth));
    t.clock.now = new Date(t.clock.now.getTime() + 8 * 24 * 3600_000);
    expect((await t.req("/auth/session", { headers: { cookie: again } })).status).toBe(401);
  });
});

describe("a signed-in browser can use the merchant API, safely", () => {
  it("the session works on /v1 for reads", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const cookie = cookieOf(await login(t, auth));
    const me = await t.req("/v1/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await json(me)).name).toBe("Acme Studio");
  });
  it("changes made with a cookie must come from our own app (CSRF)", async () => {
    const t = setup();
    const { auth } = await signup(t);
    const cookie = cookieOf(await login(t, auth));
    const body = JSON.stringify({ amount: "5" });
    const evil = await t.req("/v1/invoices", { method: "POST", body, idem: "a", headers: { cookie, origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    expect((await json(evil)).error.code).toBe("csrf");
    const none = await t.req("/v1/invoices", { method: "POST", body, idem: "b", headers: { cookie } });
    expect(none.status).toBe(403);
    const ok = await t.req("/v1/invoices", { method: "POST", body, idem: "c", headers: { cookie, origin: "https://app.test" } });
    expect(ok.status).toBe(201);
  });
  it("API keys keep working with no origin rules (server to server)", async () => {
    const t = setup();
    const { done } = await signup(t);
    const res = await t.req("/v1/invoices", { method: "POST", key: done.apiKey, idem: "x", body: JSON.stringify({ amount: "5" }) });
    expect(res.status).toBe(201);
  });
});

describe("CORS for the browser app", () => {
  it("allows credentials only for our own app origin on /auth and /v1", async () => {
    const t = setup();
    for (const path of ["/auth/login/options", "/v1/me", "/auth/session"]) {
      const res = await t.req(path, { method: "OPTIONS", headers: { origin: "https://app.test", "access-control-request-method": "POST" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.test");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      const evil = await t.req(path, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

void parseDerSignature;
