import { describe, expect, it, vi } from "vitest";
import { APP, REDIRECT, authParams, connect, decide, form, json, pkce, registerClient, seedMerchant, sessionCookie, setup, type T } from "./helpers/oauth";

const bearer = (t: T, path: string, token: string, init: RequestInit = {}) => t.req(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as object) } });
const tokenReq = (t: T, o: Record<string, string>) => t.req("/oauth/token", { method: "POST", ...form(o) });
const auditActions = async (t: T) => ((await t.db.prepare("select action from audit_log").all()).results as { action: string }[]).map((r) => r.action);

describe("discovery", () => {
  it("publishes the authorization server: PKCE S256 only, public clients, the consent page on our app", async () => {
    const t = setup();
    const res = await t.req("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      issuer: "https://api.test",
      authorization_endpoint: `${APP}/oauth/authorize`,
      token_endpoint: "https://api.test/oauth/token",
      registration_endpoint: "https://api.test/oauth/register",
      revocation_endpoint: "https://api.test/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "draft", "write"],
    });
  });
  it("publishes the protected resource and where to sign in", async () => {
    const t = setup();
    const body = await json(await t.req("/.well-known/oauth-protected-resource"));
    expect(body).toMatchObject({ resource: "https://api.test", authorization_servers: ["https://api.test"], scopes_supported: ["read", "draft", "write"], bearer_methods_supported: ["header"] });
  });
});

describe("dynamic client registration", () => {
  it("registers a public client and hands back no secret", async () => {
    const { res, body } = await registerClient(setup(), ["https://agent.example/callback", "http://localhost:8123/cb", "http://127.0.0.1:9/cb"]);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ client_name: "Cool Agent", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(body.client_id).toMatch(/^mcp_/);
    expect(body.client_secret).toBeUndefined();
  });
  it("accepts only https or localhost redirect addresses, without fragments", async () => {
    const t = setup();
    for (const bad of ["http://agent.example/cb", "javascript:alert(1)", "https://agent.example/cb#x", "ftp://a.example/", "not a url", "https://user:pw@agent.example/cb", "http://localhost.evil.com/cb"]) {
      const { res, body } = await registerClient(t, [bad]);
      expect(res.status, bad).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
    expect((await registerClient(t, [])).res.status).toBe(400);
    expect((await registerClient(t, Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`))).res.status).toBe(400);
    expect((await registerClient(t, [REDIRECT], "")).body.error).toBe("invalid_client_metadata");
  });
  it("is rate-limited per address", async () => {
    const t = setup();
    for (let i = 0; i < 20; i++) expect((await registerClient(t)).res.status).toBe(201);
    expect((await registerClient(t)).res.status).toBe(429);
  });
});

describe("authorization request", () => {
  it("needs the business to be signed in", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id);
    expect((await t.req(`/oauth/authorize?${new URLSearchParams(params)}`)).status).toBe(401);
  });
  it("tells the consent page who is asking, in what words and where they will go back to", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id, { scope: "read draft" });
    const res = await t.req(`/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie, origin: APP } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ client: { id: client.client_id, name: "Cool Agent" }, redirectHost: "agent.example", scopes: ["read", "draft"], business: "Acme" });
  });
  it("never redirects to an address that is not registered exactly", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    for (const uri of [REDIRECT + "/", REDIRECT + "?a=1", "https://agent.example/callbackx", "https://AGENT.example/callback", "https://evil.example/callback", "http://agent.example/callback"]) {
      const { params } = authParams(client.client_id, { redirect_uri: uri });
      const get = await t.req(`/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie } });
      const post = await decide(t, params, cookie);
      for (const res of [get, post]) {
        expect(res.status, uri).toBe(400);
        const b = await json(res);
        expect(b.redirectTo).toBeUndefined();
        expect(JSON.stringify(b)).not.toContain("evil.example");
      }
    }
    expect((await decide(t, authParams("mcp_unknown").params, cookie)).status).toBe(400);
  });
  it("rejects requests without PKCE S256, with an unknown scope, or for another response type, by redirecting the error back", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    const cases: [Record<string, string>, string][] = [
      [{ code_challenge: "" }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge_method: "" }, "invalid_request"],
      [{ scope: "read admin" }, "invalid_scope"],
      [{ response_type: "token" }, "unsupported_response_type"],
    ];
    for (const [over, error] of cases) {
      const { params } = authParams(client.client_id, over);
      const res = await decide(t, params, cookie);
      expect(res.status, JSON.stringify(over)).toBe(400);
      const url = new URL((await json(res)).redirectTo);
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("error")).toBe(error);
      expect(url.searchParams.get("state")).toBe("xyz");
    }
    expect(await t.db.prepare("select count(*) as n from oauth_codes").first("n")).toBe(0);
  });
  it("needs a session cookie for the decision: an API key is not a person's consent", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id);
    expect((await decide(t, params, null)).status).toBe(401);
    expect((await decide(t, params, null, "approve", { authorization: `Bearer ${key}` })).status).toBe(401);
  });
  it("refuses a decision that does not come from our own app", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id);
    for (const origin of ["https://evil.example", ""]) {
      const res = await decide(t, params, cookie, "approve", { origin });
      expect(res.status, origin).toBe(403);
      expect((await json(res)).error.code).toBe("csrf");
    }
    expect(await t.db.prepare("select count(*) as n from oauth_codes").first("n")).toBe(0);
  });
  it("on approve returns the registered address with a one-time code and the state; only a hash is kept", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id);
    const res = await decide(t, params, cookie);
    expect(res.status).toBe(200);
    const url = new URL((await json(res)).redirectTo);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("xyz");
    const code = url.searchParams.get("code")!;
    expect(code.length).toBeGreaterThanOrEqual(40);
    const row = (await t.db.prepare("select * from oauth_codes").first()) as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("on deny sends access_denied and creates nothing", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const cookie = await sessionCookie(t);
    const { body: client } = await registerClient(t);
    const { params } = authParams(client.client_id);
    const url = new URL((await json(await decide(t, params, cookie, "deny"))).redirectTo);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("code")).toBeNull();
    expect(await t.db.prepare("select count(*) as n from oauth_codes").first("n")).toBe(0);
  });
});

describe("token endpoint: authorization code", () => {
  it("exchanges a code with the right verifier for an access and a refresh token, stored only as hashes", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { res, tokens } = await connect(t, "read draft");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read draft" });
    expect(tokens.access_token).toMatch(/^smt_at_[0-9a-f]{64}$/);
    expect(tokens.refresh_token).toMatch(/^smt_rt_[0-9a-f]{64}$/);
    const rows = (await t.db.prepare("select * from oauth_tokens").all()).results as Record<string, string>[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain(tokens.access_token.slice(7));
      expect(JSON.stringify(r)).not.toContain(tokens.refresh_token.slice(7));
    }
    expect(await auditActions(t)).toContain("oauth.grant.created");
  });
  it("requires the PKCE verifier and checks it against the challenge", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client } = await connect(t); // only for a registered client
    const cookie = await sessionCookie(t);
    const flow = async () => {
      const a = authParams(client.client_id);
      const code = new URL((await json(await decide(t, a.params, cookie))).redirectTo).searchParams.get("code")!;
      return { ...a, code };
    };
    const base = (f: Awaited<ReturnType<typeof flow>>) => ({ grant_type: "authorization_code", code: f.code, redirect_uri: REDIRECT, client_id: client.client_id });
    // no verifier
    let f = await flow();
    let res = await tokenReq(t, base(f));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_request");
    // wrong verifier
    f = await flow();
    res = await tokenReq(t, { ...base(f), code_verifier: pkce().verifier });
    expect((await json(res)).error).toBe("invalid_grant");
    // sending the challenge as the verifier (what "plain" would do) fails
    f = await flow();
    res = await tokenReq(t, { ...base(f), code_verifier: f.p.challenge });
    expect((await json(res)).error).toBe("invalid_grant");
    // a verifier that is too short is malformed
    f = await flow();
    res = await tokenReq(t, { ...base(f), code_verifier: "short" });
    expect(res.status).toBe(400);
    // wrong guesses do not burn other codes; the right verifier succeeds
    f = await flow();
    expect((await tokenReq(t, { ...base(f), code_verifier: f.p.verifier })).status).toBe(200);
  });
  it("binds the code to its client and redirect address", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, cookie } = await connect(t);
    const { body: other } = await registerClient(t, [REDIRECT, "https://agent.example/other"]);
    const a = authParams(client.client_id);
    const code = new URL((await json(await decide(t, a.params, cookie))).redirectTo).searchParams.get("code")!;
    const good = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: a.p.verifier };
    expect((await json(await tokenReq(t, { ...good, client_id: other.client_id }))).error).toBe("invalid_grant");
    expect((await json(await tokenReq(t, { ...good, redirect_uri: "https://agent.example/other" }))).error).toBe("invalid_grant");
    expect((await tokenReq(t, good)).status).toBe(200);
  });
  it("refuses a code after 60 seconds", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, cookie } = await connect(t);
    const a = authParams(client.client_id);
    const code = new URL((await json(await decide(t, a.params, cookie))).redirectTo).searchParams.get("code")!;
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    const res = await tokenReq(t, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: a.p.verifier });
    expect((await json(res)).error).toBe("invalid_grant");
  });
  it("uses a code once; a replay fails and revokes everything issued from it", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, code, p, tokens } = await connect(t, "write");
    expect((await bearer(t, "/v1/me", tokens.access_token)).status).toBe(200);
    const res = await tokenReq(t, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: p.verifier });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_grant");
    expect((await bearer(t, "/v1/me", tokens.access_token)).status).toBe(401);
    expect((await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).status).toBe(400);
    expect(await auditActions(t)).toContain("oauth.grant.revoked");
  });
  it("answers unknown grant types and clients the standard way", async () => {
    const t = setup();
    expect((await json(await tokenReq(t, { grant_type: "password" }))).error).toBe("unsupported_grant_type");
    expect((await json(await tokenReq(t, { grant_type: "authorization_code", code: "x", client_id: "mcp_nope", redirect_uri: REDIRECT, code_verifier: pkce().verifier }))).error).toBe("invalid_grant");
    expect((await tokenReq(t, { grant_type: "authorization_code" })).status).toBe(400);
  });
});

describe("token endpoint: refresh", () => {
  it("rotates the refresh token and the old one stops working", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, tokens } = await connect(t, "draft");
    const res = await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(res.status).toBe(200);
    const next = await json(res);
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.scope).toBe("draft");
    expect((await bearer(t, "/v1/me", next.access_token)).status).toBe(200);
  });
  it("treats a reused refresh token as theft: refuses it and revokes the whole grant", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, tokens } = await connect(t);
    const next = await json(await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }));
    const replay = await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe("invalid_grant");
    expect((await bearer(t, "/v1/me", next.access_token)).status).toBe(401);
    expect((await tokenReq(t, { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: client.client_id })).status).toBe(400);
  });
  it("refuses an expired refresh token, another client's, and an access token in its place", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, tokens } = await connect(t);
    const { body: other } = await registerClient(t);
    expect((await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: other.client_id })).status).toBe(400);
    expect((await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.access_token, client_id: client.client_id })).status).toBe(400);
    t.clock.now = new Date(t.clock.now.getTime() + 31 * 86_400_000);
    expect((await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id })).status).toBe(400);
  });
});

describe("bearer tokens on the API", () => {
  it("maps the token to its business", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t);
    const res = await bearer(t, "/v1/me", tokens.access_token);
    expect(await json(res)).toEqual({ id: "m_1", name: "Acme" });
  });
  it("refuses an expired, unknown or revoked token, and points to where to get one", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t);
    const bad = await bearer(t, "/v1/me", "smt_at_" + "0".repeat(64));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('resource_metadata="https://api.test/.well-known/oauth-protected-resource"');
    expect((await bearer(t, "/v1/me", "smt_at_short")).status).toBe(401);
    t.clock.now = new Date(t.clock.now.getTime() + 3_601_000);
    const expired = await bearer(t, "/v1/me", tokens.access_token);
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
  it("keeps accepting API keys", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await bearer(t, "/v1/me", key)).status).toBe(200);
  });
  it("a read token can read and cannot write", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t, "read");
    expect((await bearer(t, "/v1/invoices", tokens.access_token)).status).toBe(200);
    const res = await bearer(t, "/v1/invoices", tokens.access_token, { method: "POST", body: "{}", headers: { "content-type": "application/json", "idempotency-key": "k1" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect((await json(res)).error.code).toBe("insufficient_scope");
  });
  it("a draft token may start refund and approval drafts and nothing else that changes things", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t, "draft");
    const post = (path: string) => bearer(t, path, tokens.access_token, { method: "POST", body: "{}", headers: { "content-type": "application/json", "idempotency-key": "k" + path } });
    for (const path of ["/v1/refunds", "/v1/approvals"]) expect([401, 403], path).not.toContain((await post(path)).status);
    for (const path of ["/v1/invoices", "/v1/payment-links", "/v1/webhook-endpoints", "/v1/subscriptions"]) expect((await post(path)).status, path).toBe(403);
  });
  it("a write token reaches the routes, and each use is written to the audit log", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t, "write");
    const res = await bearer(t, "/v1/invoices", tokens.access_token, { method: "POST", body: "{}", headers: { "content-type": "application/json", "idempotency-key": "k1" } });
    expect([401, 403]).not.toContain(res.status);
    expect(await auditActions(t)).toContain("oauth.write_used");
    const row = (await t.db.prepare("select actor, payload from audit_log where action = 'oauth.write_used'").first()) as { actor: string; payload: string };
    expect(row.actor).toMatch(/^oauth:mcp_/);
    expect(row.payload).toContain("/v1/invoices");
    expect(row.payload).not.toContain(tokens.access_token);
  });
  it("no scope lets an app confirm a refund, make API keys, or manage connected apps", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { tokens } = await connect(t, "read draft write");
    const calls: [string, string][] = [
      ["POST", "/v1/refunds/rf_1/submit"],
      ["GET", "/v1/api-keys"],
      ["POST", "/v1/api-keys"],
      ["POST", "/v1/api-keys/k_1/revoke"],
      ["GET", "/v1/oauth/grants"],
      ["DELETE", "/v1/oauth/grants/g_1"],
    ];
    for (const [method, path] of calls) {
      const res = await bearer(t, path, tokens.access_token, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json", "idempotency-key": "k" } } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("revocation", () => {
  it("revoking a refresh token ends the grant, including its access token", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, tokens } = await connect(t);
    const res = await t.req("/oauth/revoke", { method: "POST", ...form({ token: tokens.refresh_token, client_id: client.client_id }) });
    expect(res.status).toBe(200);
    expect((await bearer(t, "/v1/me", tokens.access_token)).status).toBe(401);
    expect(await auditActions(t)).toContain("oauth.grant.revoked");
  });
  it("revoking an access token works too, an unknown token still answers 200, and another client cannot revoke it", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const { client, tokens } = await connect(t);
    const { body: other } = await registerClient(t);
    await t.req("/oauth/revoke", { method: "POST", ...form({ token: tokens.access_token, client_id: other.client_id }) });
    expect((await bearer(t, "/v1/me", tokens.access_token)).status).toBe(200);
    expect((await t.req("/oauth/revoke", { method: "POST", ...form({ token: "smt_rt_" + "1".repeat(64), client_id: client.client_id }) })).status).toBe(200);
    await t.req("/oauth/revoke", { method: "POST", ...form({ token: tokens.access_token, client_id: client.client_id }) });
    expect((await bearer(t, "/v1/me", tokens.access_token)).status).toBe(401);
  });
});

describe("connected apps", () => {
  it("lists the business's apps (never a token) and lets it revoke one", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    const mine = await connect(t, "read draft");
    await connect(t, "read", "m_2");
    const res = await t.req("/v1/oauth/grants", { key });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ clientName: "Cool Agent", scopes: ["read", "draft"], revoked: false });
    expect(JSON.stringify(body)).not.toMatch(/smt_|hash/);
    const del = await t.req(`/v1/oauth/grants/${body.data[0].id}`, { method: "DELETE", key });
    expect(del.status).toBe(200);
    expect((await bearer(t, "/v1/me", mine.tokens.access_token)).status).toBe(401);
    expect(((await json(await t.req("/v1/oauth/grants", { key }))).data as unknown[]).length).toBe(0);
    expect(await auditActions(t)).toContain("oauth.grant.revoked");
  });
  it("will not touch another business's grant", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    const theirs = await connect(t, "read", "m_2");
    const id = (await t.db.prepare("select id from oauth_grants").first("id")) as string;
    expect((await t.req(`/v1/oauth/grants/${id}`, { method: "DELETE", key })).status).toBe(404);
    expect((await bearer(t, "/v1/me", theirs.tokens.access_token)).status).toBe(200);
  });
});

describe("secrets", () => {
  it("never writes a code or token to the logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const t = setup();
      await seedMerchant(t.db);
      const { code, tokens, client } = await connect(t, "write");
      await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
      await tokenReq(t, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      for (const secret of [code, tokens.access_token, tokens.refresh_token]) expect(logged).not.toContain(secret);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
