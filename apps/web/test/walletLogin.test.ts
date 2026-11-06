import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { describe, expect, it } from "vitest";
import { AuthError } from "../lib/auth";
import type { Eip1193 } from "../lib/wallet";
import { injectedProvider, loginErrorText, signInWithWallet } from "../lib/walletLogin";

const where = { host: "app.stenmont.com", origin: "https://app.stenmont.com" };
const NONCE = "abcdef1234567890abcdef1234567890";

/** A wallet extension: answers eth_requestAccounts and signs personal_sign for real. */
function fakeWallet(opts: { reject?: boolean } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const calls: string[] = [];
  const provider: Eip1193 = {
    async request({ method, params }) {
      calls.push(method);
      if (opts.reject) throw Object.assign(new Error("User rejected"), { code: 4001 });
      if (method === "eth_requestAccounts") return [account.address];
      if (method === "personal_sign") return account.signMessage({ message: { raw: (params as string[])[0] as `0x${string}` } });
      throw new Error(`unexpected ${method}`);
    },
  };
  return { account, provider, calls };
}

function fakeApi(verify: () => unknown = () => ({ signedIn: true })) {
  const posts: { path: string; body: unknown }[] = [];
  const post = async <T,>(path: string, body?: unknown): Promise<T> => {
    posts.push({ path, body });
    if (path === "/auth/siwe/nonce") return { nonce: NONCE } as T;
    return verify() as T;
  };
  return { post, posts };
}

describe("sign in with a wallet", () => {
  it("asks for a nonce, signs a login message the server can verify, and sends intent login", async () => {
    const w = fakeWallet();
    const a = fakeApi();
    await signInWithWallet(w.provider, a.post, where, new Date("2026-11-06T10:00:00Z"));
    expect(a.posts.map((p) => p.path)).toEqual(["/auth/siwe/nonce", "/auth/siwe/verify"]);
    const sent = a.posts[1]!.body as { message: string; signature: `0x${string}`; intent: string };
    expect(sent.intent).toBe("login");
    expect(sent.message).toContain("Sign in to your Stenmont business.");
    expect(sent.message).toContain(NONCE);
    expect(sent.message).toContain("app.stenmont.com");
    expect(await verifyMessage({ address: w.account.address, message: sent.message, signature: sent.signature })).toBe(true);
  });
  it("propagates the server's refusal (wallet not linked) and shows where to link it", async () => {
    const w = fakeWallet();
    const a = fakeApi(() => { throw new AuthError("wallet_not_linked", "x"); });
    const err = await signInWithWallet(w.provider, a.post, where).catch((e) => e);
    expect(loginErrorText(err)).toMatch(/Verification/);
    expect(loginErrorText(err)).toMatch(/passkey/);
  });
  it("turns a cancelled prompt into a calm message and sends nothing", async () => {
    const w = fakeWallet({ reject: true });
    const a = fakeApi();
    const err = await signInWithWallet(w.provider, a.post, where).catch((e) => e);
    expect(a.posts).toHaveLength(0);
    expect(loginErrorText(err)).toMatch(/cancelled/i);
  });
  it("covers the other plain-words errors", () => {
    expect(loginErrorText(new AuthError("nonce_invalid", "x"))).toMatch(/timed out|already used/);
    expect(loginErrorText(new AuthError("siwe_invalid", "x", { reason: "expired" }))).toMatch(/too long/);
    expect(loginErrorText(new AuthError("rate_limited", "x"))).toMatch(/Wait a minute/);
    expect(loginErrorText(new AuthError("not_activated", "x"))).toMatch(/passkey/);
    expect(loginErrorText(new Error("boom"))).toMatch(/could not sign you in/);
  });
  it("hides the button when no wallet is present", () => {
    expect(injectedProvider({})).toBeNull();
    expect(injectedProvider({ ethereum: {} })).toBeNull();
    expect(injectedProvider({ ethereum: { request: async () => null } })).not.toBeNull();
  });
});
