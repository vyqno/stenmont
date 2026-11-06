import { hashMessage, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { checkSiweMessage, verifyWalletSignature } from "../../src/verification/siwe";

const NOW = new Date("2026-11-06T12:00:00Z");
const EXPECT = { domain: "app.test", origin: "https://app.test", chainId: 1874, now: NOW };
const account = privateKeyToAccount(generatePrivateKey());
const msg = (over: Record<string, unknown> = {}) =>
  createSiweMessage({ address: account.address, chainId: 1874, domain: "app.test", nonce: "abcdef1234567890", uri: "https://app.test", version: "1", issuedAt: NOW, expirationTime: new Date(NOW.getTime() + 600_000), statement: "Link this wallet to your Stenmont business.", ...over } as never);
const reason = (m: string, e = EXPECT) => {
  const r = checkSiweMessage(m, e);
  return r.ok ? "ok" : r.reason;
};

describe("checkSiweMessage", () => {
  it("accepts a well-formed message and returns its fields", () => {
    const r = checkSiweMessage(msg(), EXPECT);
    expect(r.ok && r.message.address).toBe(account.address);
    expect(r.ok && r.message.nonce).toBe("abcdef1234567890");
  });
  it("refuses the wrong domain (phishing site) and a lookalike", () => {
    expect(reason(msg({ domain: "evil.test" }))).toBe("wrong_domain");
    expect(reason(msg({ domain: "app.test.evil.com" }))).toBe("wrong_domain");
    expect(reason(msg({ domain: "APP.test" }))).toBe("wrong_domain");
  });
  it("refuses another origin in the uri", () => {
    expect(reason(msg({ uri: "https://evil.test" }))).toBe("wrong_uri");
    expect(reason(msg({ uri: "http://app.test" }))).toBe("wrong_uri");
  });
  it("refuses the wrong chain", () => {
    expect(reason(msg({ chainId: 1 }))).toBe("wrong_chain");
  });
  it("refuses an expired message, exactly at the expiry instant", () => {
    expect(reason(msg({ expirationTime: new Date(NOW.getTime() - 1) }))).toBe("expired");
    expect(reason(msg({ expirationTime: NOW }))).toBe("expired");
    expect(reason(msg({ issuedAt: new Date(NOW.getTime() - 60_000), expirationTime: new Date(NOW.getTime() + 1) }))).toBe("ok");
  });
  it("refuses a message issued too long ago even without an expiry, and one issued in the future", () => {
    expect(reason(msg({ expirationTime: undefined, issuedAt: new Date(NOW.getTime() - 601_000) }))).toBe("expired");
    expect(reason(msg({ expirationTime: undefined, issuedAt: new Date(NOW.getTime() - 599_000) }))).toBe("ok");
    expect(reason(msg({ issuedAt: new Date(NOW.getTime() + 61_000), expirationTime: new Date(NOW.getTime() + 700_000) }))).toBe("not_yet_valid");
  });
  it("refuses notBefore in the future", () => {
    expect(reason(msg({ notBefore: new Date(NOW.getTime() + 1000) }))).toBe("not_yet_valid");
  });
  it("refuses text that is not a canonical EIP-4361 message", () => {
    expect(reason("hello")).toBe("malformed");
    expect(reason(msg() + "\nextra line")).toBe("malformed");
    expect(reason(msg().replace("Version: 1", "Version: 2"))).toBe("malformed");
    expect(reason(msg({ statement: undefined }).replace("\n\n", "\n\n\n"))).toBe("malformed");
  });
});

describe("verifyWalletSignature (EOA by recovery, contract accounts by ERC-1271)", () => {
  const text = msg();
  const noChain = { getCode: async () => undefined as Hex | undefined, isValidSignature: async () => "0xffffffff" as Hex };
  it("accepts the owner's signature without asking the chain", async () => {
    let asked = false;
    const sig = await account.signMessage({ message: text });
    expect(await verifyWalletSignature({ ...noChain, getCode: async () => ((asked = true), undefined) }, { address: account.address, message: text, signature: sig })).toBe(true);
    expect(asked).toBe(false);
  });
  it("refuses a forged signature (another key) for an EOA", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const sig = await other.signMessage({ message: text });
    expect(await verifyWalletSignature(noChain, { address: account.address, message: text, signature: sig })).toBe(false);
  });
  it("refuses garbage and a signature over a different message", async () => {
    expect(await verifyWalletSignature(noChain, { address: account.address, message: text, signature: "0x1234" })).toBe(false);
    const sig = await account.signMessage({ message: text + " " });
    expect(await verifyWalletSignature(noChain, { address: account.address, message: text, signature: sig })).toBe(false);
  });
  it("accepts a smart account when it answers the ERC-1271 magic value for the EIP-191 hash", async () => {
    const calls: Hex[] = [];
    const io = { getCode: async () => "0x6001" as Hex, isValidSignature: async (_a: string, h: Hex) => (calls.push(h), "0x1626ba7e" as Hex) };
    expect(await verifyWalletSignature(io, { address: account.address, message: text, signature: "0xabcdef" })).toBe(true);
    expect(calls).toEqual([hashMessage(text)]);
  });
  it("refuses a smart account that answers anything else, or whose check fails", async () => {
    const wrong = { getCode: async () => "0x6001" as Hex, isValidSignature: async () => "0xffffffff" as Hex };
    expect(await verifyWalletSignature(wrong, { address: account.address, message: text, signature: "0xabcdef" })).toBe(false);
    const broken = { getCode: async () => "0x6001" as Hex, isValidSignature: async () => { throw new Error("revert"); } };
    expect(await verifyWalletSignature(broken, { address: account.address, message: text, signature: "0xabcdef" })).toBe(false);
  });
});
