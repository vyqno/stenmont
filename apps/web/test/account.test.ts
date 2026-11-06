import { describe, expect, it } from "vitest";
import { ACCOUNT_COPY, accountUrl, loadAccountToken, saveAccountToken, statusLabel, tokenExpired, tokenFromHash, tokenPayer } from "../lib/account";
import { FUNDING, fundingFor } from "../lib/funding";

const BANNED = /\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;
const ADDR = "a11ce00000000000000000000000000000000001";
const exp = (s: number) => Math.floor(s);
const token = (e = 2_000_000_000) => `v1.${ADDR}.receipts.${exp(e)}.${"A".repeat(43)}`;

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("the receipts link", () => {
  it("reads the token from the address fragment, and nowhere else", () => {
    expect(tokenFromHash(`#t=${token()}`)).toBe(token());
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#t=nonsense")).toBeNull();
    expect(tokenFromHash(`#x=1&t=${token()}`)).toBe(token());
  });

  it("builds a link that keeps the token out of the path and the query", () => {
    const url = accountUrl("https://app.stenmont.com", token());
    expect(url).toBe(`https://app.stenmont.com/account#t=${token()}`);
    expect(new URL(url).search).toBe("");
  });

  it("remembers the newest token on this device and survives storage that throws", () => {
    const s = memory();
    expect(loadAccountToken(s)).toBeNull();
    saveAccountToken(s, token());
    expect(loadAccountToken(s)).toBe(token());
    saveAccountToken(s, "junk");
    expect(loadAccountToken(s)).toBe(token()); // junk is never stored
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(loadAccountToken(broken)).toBeNull();
    expect(() => saveAccountToken(broken, token())).not.toThrow();
  });

  it("knows who it is for and whether it has expired (for display only: the server decides)", () => {
    expect(tokenPayer(token())).toBe(`0x${ADDR}`);
    expect(tokenExpired(token(1_000), new Date(1_001 * 1000))).toBe(true);
    expect(tokenExpired(token(1_000), new Date(999 * 1000))).toBe(false);
  });
});

describe("what a customer reads", () => {
  it("uses no crypto words on the account page", () => {
    for (const text of Object.values(ACCOUNT_COPY).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v)))) expect(text).not.toMatch(BANNED);
    for (const s of ["active", "past_due", "cancelled", "completed", "whatever"]) expect(statusLabel(s)).not.toMatch(BANNED);
  });
  it("names subscription states plainly", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("cancelled")).toBe("Ended");
    expect(statusLabel("past_due")).toBe("Payment failed");
    expect(statusLabel("completed")).toBe("Finished");
  });
});

describe("where to get USDT", () => {
  it("points to WhiteBIT and Whitechain's own bridge, and nothing we do not offer", () => {
    expect(FUNDING.bridge.mainnet).toBe("https://bridge.whitechain.io");
    expect(FUNDING.bridge.testnet).toBe("https://bridge.testnet.whitechain.io");
    const all = JSON.stringify(FUNDING).toLowerCase();
    expect(all).toContain("whitebit");
    expect(all).toContain("we don't sell");
    for (const claim of ["credit card", "debit card", "apple pay", "instant", "buy with"]) expect(all).not.toContain(claim);
  });
  it("links the test bridge on test hosts and the live bridge on the live host", () => {
    expect(fundingFor("app-staging.stenmont.com").bridgeUrl).toBe("https://bridge.testnet.whitechain.io");
    expect(fundingFor("localhost").bridgeUrl).toBe("https://bridge.testnet.whitechain.io");
    expect(fundingFor("app.stenmont.com").bridgeUrl).toBe("https://bridge.whitechain.io");
    expect(fundingFor("app-staging.stenmont.com").testNote).toBeTruthy();
    expect(fundingFor("app.stenmont.com").testNote).toBeNull();
  });
});
