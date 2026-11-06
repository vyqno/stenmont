import { beforeAll, describe, expect, it } from "vitest";
import { createOidcVerifier } from "../../src/world/oidc";
import { rsaKey, signJwt, unsigned } from "./helpers";

const NOW = new Date("2026-11-06T10:00:00Z");
const t = Math.floor(NOW.getTime() / 1000);
const good = { iss: "https://auth.world.org", aud: "client_1", sub: "sub_1", exp: t + 600, auth_time: t - 30, nonce: "n1" };
let key: Awaited<ReturnType<typeof rsaKey>>;
let calls = 0;
beforeAll(async () => (key = await rsaKey()));
const verifier = (jwks: () => unknown = () => key.jwks, now = NOW) => {
  calls = 0;
  const f = async () => ((calls += 1), new Response(JSON.stringify(jwks())));
  return createOidcVerifier({ issuer: "https://auth.world.org", audience: "client_1", jwksUrl: "https://auth.world.org/jwks", fetch: f as typeof fetch, now: () => now });
};
const check = async (claims: object, nonce = "n1") => verifier()(await signJwt(key.priv, claims), { nonce });

describe("verifyIdToken", () => {
  it("accepts a good token and returns claims", async () => {
    expect(await check(good)).toMatchObject({ ok: true, claims: { sub: "sub_1" } });
  });
  it("wrong issuer / audience (string and array)", async () => {
    expect(await check({ ...good, iss: "https://evil" })).toEqual({ ok: false, reason: "wrong_issuer" });
    expect(await check({ ...good, aud: "other" })).toEqual({ ok: false, reason: "wrong_audience" });
    expect(await check({ ...good, aud: ["x", "client_1"] })).toMatchObject({ ok: true });
    expect(await check({ ...good, aud: ["x"] })).toEqual({ ok: false, reason: "wrong_audience" });
  });
  it("expired (and exactly at exp)", async () => {
    expect(await check({ ...good, exp: t - 1 })).toEqual({ ok: false, reason: "expired" });
    expect(await check({ ...good, exp: t })).toEqual({ ok: false, reason: "expired" });
    expect(await check({ ...good, exp: undefined })).toEqual({ ok: false, reason: "expired" });
  });
  it("nonce mismatch", async () => {
    expect(await check(good, "other")).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(await check({ ...good, nonce: undefined })).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
  it("auth_time: 5 minutes ok, older stale, future stale, missing stale", async () => {
    expect(await check({ ...good, auth_time: t - 300 })).toMatchObject({ ok: true });
    expect(await check({ ...good, auth_time: t - 301 })).toEqual({ ok: false, reason: "stale_auth" });
    expect(await check({ ...good, auth_time: t + 3600 })).toEqual({ ok: false, reason: "stale_auth" });
    expect(await check({ ...good, auth_time: undefined })).toEqual({ ok: false, reason: "stale_auth" });
    expect(await check({ ...good, auth_time: "now" })).toEqual({ ok: false, reason: "stale_auth" });
  });
  it("tampered payload or signature", async () => {
    const tok = await signJwt(key.priv, good);
    const [h, p, s] = tok.split(".");
    const forged = btoa(JSON.stringify({ ...good, sub: "admin" })).replace(/=+$/, "");
    expect(await verifier()(`${h}.${forged}.${s}`, { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
    const flipped = s!.slice(0, -2) + (s!.endsWith("AA") ? "BB" : "AA");
    expect(await verifier()(`${h}.${p}.${flipped}`, { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("signed by a different key", async () => {
    const other = await rsaKey();
    expect(await verifier()(await signJwt(other.priv, good), { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("alg confusion: none and HS256 are rejected even with a plausible signature", async () => {
    for (const alg of ["none", "NONE", "HS256", "ES256"]) {
      expect(await verifier()(unsigned(good, { alg, kid: "k1" }), { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
    }
    expect(await verifier()(unsigned(good, { alg: "none" }, ""), { nonce: "n1" })).toEqual({ ok: false, reason: "malformed" });
    expect(await verifier()(unsigned(good, {}), { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("unknown kid", async () => {
    expect(await verifier()(await signJwt(key.priv, good, { alg: "RS256", kid: "nope" }), { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("malformed input", async () => {
    for (const tok of ["", "a.b", "a.b.c.d", "!!.!!.!!", "e30.e30.", `${btoa("nope")}.e30.AAAA`]) {
      expect(await verifier()(tok, { nonce: "n1" })).toEqual({ ok: false, reason: "malformed" });
    }
    expect(await verifier()(123 as any, { nonce: "n1" })).toEqual({ ok: false, reason: "malformed" });
  });
  it("jwks fetch failure fails closed", async () => {
    const f = async () => new Response("no", { status: 500 });
    const v = createOidcVerifier({ issuer: "https://auth.world.org", audience: "client_1", jwksUrl: "u", fetch: f as typeof fetch, now: () => NOW });
    expect(await v(await signJwt(key.priv, good), { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("caches the JWKS across tokens", async () => {
    const v = verifier();
    const tok = await signJwt(key.priv, good);
    await v(tok, { nonce: "n1" });
    await v(tok, { nonce: "n1" });
    expect(calls).toBe(1);
  });
  it("refetches on an unknown kid (rotation), but at most once a minute", async () => {
    let rotated = false;
    let clock = NOW;
    const f = async () => ((calls += 1), new Response(JSON.stringify(rotated ? key.jwks : { keys: [] })));
    calls = 0;
    const v = createOidcVerifier({ issuer: "https://auth.world.org", audience: "client_1", jwksUrl: "u", fetch: f as typeof fetch, now: () => clock });
    const tok = await signJwt(key.priv, good);
    expect(await v(tok, { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(calls).toBe(1); // forced refetch suppressed: just loaded
    rotated = true;
    expect(await v(tok, { nonce: "n1" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(calls).toBe(1);
    clock = new Date(NOW.getTime() + 61_000);
    expect(await v(await signJwt(key.priv, { ...good, exp: t + 900 }), { nonce: "n1" })).toMatchObject({ ok: true });
    expect(calls).toBe(2);
  });
});
