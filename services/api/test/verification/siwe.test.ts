import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { b64urlDecode } from "@stenmont/shared";
import { fakeAuthenticator } from "../helpers/authenticator";
import { setup } from "../helpers/app";

type T = ReturnType<typeof setup>;
const json = async (r: Response) => (await r.json()) as any;
const ORIGIN = "https://app.test";
const post = (t: T, path: string, body: unknown, headers: Record<string, string> = {}) =>
  t.req(path, { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": "1.1.1.1", ...headers } });

/** A business signed up with a passkey; returns its cookie. */
async function signUp(t: T, name = "Acme") {
  const auth = fakeAuthenticator();
  const o = await json(await post(t, "/auth/register/options", { businessName: name }));
  const reg = await json(await post(t, "/auth/register/verify", { challengeId: o.challengeId, ...auth.attestation(o.options.challenge) }));
  const act = await post(t, "/auth/activate", { challengeId: reg.activation.challengeId, ...auth.assertion(b64urlDecode(reg.activation.challenge)) });
  const cookie = (act.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { cookie, merchantId: ((await json(act)).merchant as { id: string }).id, headers: { cookie, origin: ORIGIN } };
}

/** Every passkey gets its own account address (the default fake gives them all the same one). */
const manyAccounts = () => setup({ async passkeyAddress(qx) { return `0x${qx.slice(2, 42)}` as `0x${string}`; } });
const wallet = privateKeyToAccount(generatePrivateKey());
async function nonce(t: T, headers: Record<string, string> = {}) {
  const res = await post(t, "/auth/siwe/nonce", {}, headers);
  expect(res.status).toBe(200);
  return (await json(res)).nonce as string;
}
const compose = (t: T, n: string, over: Record<string, unknown> = {}) =>
  createSiweMessage({ address: wallet.address, chainId: 1874, domain: "app.test", nonce: n, uri: ORIGIN, version: "1", issuedAt: t.clock.now, expirationTime: new Date(t.clock.now.getTime() + 600_000), statement: "Link this wallet to your Stenmont business.", ...over } as never);
async function signed(t: T, over: Record<string, unknown> = {}, signer = wallet) {
  const message = compose(t, (over.nonce as string) ?? (await nonce(t)), over);
  return { message, signature: await signer.signMessage({ message }) };
}
/** Link when a session cookie is sent, otherwise sign in. */
const verify = (t: T, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) => post(t, "/auth/siwe/verify", { intent: headers.cookie ? "link" : "login", ...(body as object) }, headers);

describe("POST /auth/siwe/nonce", () => {
  it("gives a fresh single-use nonce", async () => {
    const t = setup();
    const a = await nonce(t);
    const b = await nonce(t);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  it("is rate limited per IP", async () => {
    const t = setup();
    const codes = [];
    for (let i = 0; i < 70; i++) codes.push((await post(t, "/auth/siwe/nonce", {})).status);
    expect(codes.at(-1)).toBe(429);
  });
});

describe("linking a wallet (signed in with a passkey)", () => {
  it("links the wallet and writes an audit row", async () => {
    const t = setup();
    const b = await signUp(t);
    const res = await verify(t, await signed(t), b.headers);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ linked: true, address: wallet.address });
    const row = await t.db.prepare("select merchant_id from wallet_logins where address = ?").bind(wallet.address.toLowerCase()).first();
    expect(row).toMatchObject({ merchant_id: b.merchantId });
    const actions = ((await t.db.prepare("select action from audit_log where merchant_id = ?").bind(b.merchantId).all()).results as { action: string }[]).map((r) => r.action);
    expect(actions).toContain("wallet.linked");
  });
  it("is idempotent for the same business, and refuses a wallet that belongs to another business", async () => {
    const t = manyAccounts();
    const a = await signUp(t, "Alpha Ltd");
    const b = await signUp(t, "Bravo Ltd");
    expect((await verify(t, await signed(t), a.headers)).status).toBe(200);
    expect((await verify(t, await signed(t), a.headers)).status).toBe(200);
    const taken = await verify(t, await signed(t), b.headers);
    expect(taken.status).toBe(409);
    expect((await json(taken)).error.code).toBe("wallet_taken");
  });
  it("allows at most 5 wallets per business", async () => {
    const t = setup();
    const b = await signUp(t);
    for (let i = 0; i < 5; i++) {
      const w = privateKeyToAccount(generatePrivateKey());
      const n = await nonce(t);
      const message = compose(t, n, { address: w.address });
      expect((await verify(t, { message, signature: await w.signMessage({ message }) }, b.headers)).status).toBe(200);
    }
    const w = privateKeyToAccount(generatePrivateKey());
    const message = compose(t, await nonce(t), { address: w.address });
    expect((await verify(t, { message, signature: await w.signMessage({ message }) }, b.headers)).status).toBe(409);
  });
  it("accepts a smart account through ERC-1271", async () => {
    const t = setup();
    const b = await signUp(t);
    const smart = "0x9999999999999999999999999999999999999999" as const;
    t.chain.contractWallets.set(smart, (_h, sig) => sig === "0xc0ffee");
    const message = compose(t, await nonce(t), { address: smart });
    expect((await verify(t, { message, signature: "0xc0ffee" }, b.headers)).status).toBe(200);
    const message2 = compose(t, await nonce(t), { address: smart });
    expect((await verify(t, { message: message2, signature: "0xbad0" }, b.headers)).status).toBe(401);
  });
  it("lists and removes linked wallets, with the ENS primary name when there is one", async () => {
    const t = setup();
    const b = await signUp(t);
    t.ens.primaryNames.set(wallet.address.toLowerCase(), "vitalik.eth");
    await verify(t, await signed(t), b.headers);
    const list = await json(await t.req("/auth/siwe/wallets", { headers: b.headers }));
    expect(list.wallets).toEqual([{ address: wallet.address, ensName: "vitalik.eth", linkedAt: expect.any(String) }]);
    expect((await t.req(`/auth/siwe/wallets/${wallet.address}`, { method: "DELETE", headers: b.headers })).status).toBe(204);
    expect((await json(await t.req("/auth/siwe/wallets", { headers: b.headers }))).wallets).toEqual([]);
  });
  it("one business cannot remove another's wallet", async () => {
    const t = manyAccounts();
    const a = await signUp(t, "Alpha Ltd");
    const b = await signUp(t, "Bravo Ltd");
    await verify(t, await signed(t), a.headers);
    await t.req(`/auth/siwe/wallets/${wallet.address}`, { method: "DELETE", headers: b.headers });
    expect((await json(await t.req("/auth/siwe/wallets", { headers: a.headers }))).wallets).toHaveLength(1);
  });
});

describe("signing in with a linked wallet", () => {
  it("starts a session for the business that linked it", async () => {
    const t = setup();
    const b = await signUp(t);
    await verify(t, await signed(t), b.headers);
    const res = await verify(t, await signed(t));
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toContain("stenmont_test");
    const me = await json(await t.req("/auth/session", { headers: { cookie } }));
    expect(me.merchant.id).toBe(b.merchantId);
    expect(me.credentialId).toBeTruthy(); // onchain actions still need the passkey
  });
  it("does not create an account for an unknown wallet", async () => {
    const t = setup();
    const res = await verify(t, await signed(t));
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe("wallet_not_linked");
    expect(((await t.db.prepare("select count(*) as n from merchants").first()) as { n: number }).n).toBe(0);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("must come from our own app", async () => {
    const t = setup();
    const b = await signUp(t);
    await verify(t, await signed(t), b.headers);
    expect((await verify(t, await signed(t), {})).status).toBe(403);
    expect((await verify(t, await signed(t), { origin: "https://evil.test" })).status).toBe(403);
  });
});

describe("a bad message or signature is refused and nothing is linked", () => {
  const nothingLinked = async (t: T) => expect(((await t.db.prepare("select count(*) as n from wallet_logins").first()) as { n: number }).n).toBe(0);
  it("wrong domain", async () => {
    const t = setup();
    const b = await signUp(t);
    const res = await verify(t, await signed(t, { domain: "evil.test" }), b.headers);
    expect(res.status).toBe(400);
    expect((await json(res)).error.details.reason).toBe("wrong_domain");
    await nothingLinked(t);
  });
  it("wrong chain", async () => {
    const t = setup();
    const b = await signUp(t);
    const res = await verify(t, await signed(t, { chainId: 1 }), b.headers);
    expect((await json(res)).error.details.reason).toBe("wrong_chain");
    await nothingLinked(t);
  });
  it("expired message", async () => {
    const t = setup();
    const b = await signUp(t);
    const s = await signed(t);
    t.clock.now = new Date(t.clock.now.getTime() + 601_000);
    const res = await verify(t, s, b.headers);
    expect(res.status).toBe(400);
    expect((await json(res)).error.details.reason).toBe("expired");
    await nothingLinked(t);
  });
  it("a nonce used once cannot be used again", async () => {
    const t = setup();
    const b = await signUp(t);
    const n = await nonce(t);
    expect((await verify(t, await signed(t, { nonce: n }), b.headers)).status).toBe(200);
    // log out of the wallet link and try the same nonce again
    await t.req(`/auth/siwe/wallets/${wallet.address}`, { method: "DELETE", headers: b.headers });
    const replay = await verify(t, await signed(t, { nonce: n }), b.headers);
    expect(replay.status).toBe(400);
    expect((await json(replay)).error.code).toBe("nonce_invalid");
    await nothingLinked(t);
  });
  it("a nonce we never issued, and an expired nonce", async () => {
    const t = setup();
    const b = await signUp(t);
    const made = await verify(t, await signed(t, { nonce: "deadbeefdeadbeefdeadbeef" }), b.headers);
    expect((await json(made)).error.code).toBe("nonce_invalid");
    const n = await nonce(t);
    await t.db.prepare("update siwe_nonces set expires_at = ?").bind(new Date(t.clock.now.getTime() - 1).toISOString()).run();
    const old = await verify(t, await signed(t, { nonce: n }), b.headers);
    expect((await json(old)).error.code).toBe("nonce_invalid");
    await nothingLinked(t);
  });
  it("a forged signature (someone else's key) and a wrong-message signature", async () => {
    const t = setup();
    const b = await signUp(t);
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await verify(t, await signed(t, {}, other), b.headers);
    expect(forged.status).toBe(401);
    expect((await json(forged)).error.code).toBe("bad_signature");
    const s = await signed(t);
    const swapped = await verify(t, { message: s.message, signature: await wallet.signMessage({ message: "something else" }) }, b.headers);
    expect(swapped.status).toBe(401);
    await nothingLinked(t);
  });
  it("a failed signature still burns the nonce", async () => {
    const t = setup();
    const b = await signUp(t);
    const n = await nonce(t);
    const other = privateKeyToAccount(generatePrivateKey());
    await verify(t, await signed(t, { nonce: n }, other), b.headers);
    const again = await verify(t, await signed(t, { nonce: n }), b.headers);
    expect((await json(again)).error.code).toBe("nonce_invalid");
  });
  it("rejects bodies that are not a message and a signature", async () => {
    const t = setup();
    expect((await verify(t, { message: "hi" })).status).toBe(400);
    expect((await verify(t, { message: "hi", signature: "nope" })).status).toBe(400);
    expect((await post(t, "/auth/siwe/verify", { message: "hi", signature: "0x12" }, { origin: ORIGIN })).status).toBe(400); // no intent
    expect((await verify(t, { message: "x".repeat(5000), signature: "0x12" })).status).toBe(400);
  });
});
