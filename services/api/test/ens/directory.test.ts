import { describe, expect, it } from "vitest";
import { DIRECTORY_KEYS, LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, X402_KEY, USDT_ADDRESS, parseLimitsRecord, parseTokenRecord, toUnits } from "@stenmont/shared";
import { buildDirectory, diffDirectory, type DirectoryFacts } from "../../src/ens/directory";

const facts = (over: Partial<DirectoryFacts> = {}): DirectoryFacts => ({
  chainId: 1874,
  usdt: USDT_ADDRESS,
  perInvoice: toUnits("2000"),
  verifiedHosts: ["acme.example"],
  payUrl: "https://pay.acme.example/checkout/",
  x402Url: "https://api.acme.example/v1/premium",
  refund: "Full refund within 14 days, write to billing@acme.example",
  ...over,
});

describe("buildDirectory", () => {
  it("builds the whole record set from facts we hold", () => {
    const { records, omitted } = buildDirectory(facts());
    expect(omitted).toEqual([]);
    expect(Object.keys(records).sort()).toEqual([...DIRECTORY_KEYS].sort());
    expect(records[PAY_KEY]).toBe("https://pay.acme.example/checkout");
    expect(records[X402_KEY]).toBe("https://api.acme.example/v1/premium");
    expect(parseTokenRecord(records[TOKEN_KEY]!)).toEqual({ chainId: 1874, address: USDT_ADDRESS });
    expect(parseLimitsRecord(records[LIMITS_KEY]!)).toEqual({ perInvoice: toUnits("2000") });
    expect(records[REFUND_KEY]).toBe("Full refund within 14 days, write to billing@acme.example");
  });
  it("always publishes the derived token and cap, even with nothing else set", () => {
    const { records, omitted } = buildDirectory(facts({ payUrl: null, x402Url: null, refund: null, verifiedHosts: [] }));
    expect(Object.keys(records).sort()).toEqual([LIMITS_KEY, TOKEN_KEY]);
    expect(omitted).toEqual([]);
  });
  it("accepts a verified host or any subdomain of it, and nothing else", () => {
    expect(buildDirectory(facts({ payUrl: "https://acme.example/pay" })).records[PAY_KEY]).toBe("https://acme.example/pay");
    expect(buildDirectory(facts({ payUrl: "https://evil-acme.example/pay" })).omitted).toContainEqual({ key: PAY_KEY, reason: "host_not_verified" });
    expect(buildDirectory(facts({ payUrl: "https://acme.example.evil.com/pay" })).omitted).toContainEqual({ key: PAY_KEY, reason: "host_not_verified" });
    expect(buildDirectory(facts({ x402Url: "https://other.example/x" })).omitted).toContainEqual({ key: X402_KEY, reason: "host_not_verified" });
    expect(buildDirectory(facts({ verifiedHosts: [] })).omitted.map((o) => o.key).sort()).toEqual([PAY_KEY, X402_KEY].sort());
  });
  it("refuses addresses that are not plain public https", () => {
    for (const bad of ["http://pay.acme.example/x", "https://user:pw@pay.acme.example/x", "https://pay.acme.example:8443/x", "javascript:alert(1)", "pay.acme.example", "https://127.0.0.1/x"]) {
      const r = buildDirectory(facts({ payUrl: bad }));
      expect(r.records[PAY_KEY]).toBeUndefined();
      expect(r.omitted).toHaveLength(1);
      expect(r.omitted[0]).toMatchObject({ key: PAY_KEY });
    }
  });
  it("takes a refund policy as short plain text or as a link on a verified host", () => {
    expect(buildDirectory(facts({ refund: "https://acme.example/refunds" })).records[REFUND_KEY]).toBe("https://acme.example/refunds");
    expect(buildDirectory(facts({ refund: "https://elsewhere.example/refunds" })).omitted).toContainEqual({ key: REFUND_KEY, reason: "host_not_verified" });
    expect(buildDirectory(facts({ refund: "  Refunds: 30 days  " })).records[REFUND_KEY]).toBe("Refunds: 30 days");
    for (const [bad, reason] of [["x".repeat(281), "too_long"], ["line one\nline two", "bad_text"], ["javascript:alert(1)", "bad_text"], ["data:text/html,x", "bad_text"], ["http://acme.example/r", "bad_text"], ["   ", "bad_text"]] as const) {
      const r = buildDirectory(facts({ refund: bad }));
      expect(r.records[REFUND_KEY]).toBeUndefined();
      expect(r.omitted).toContainEqual({ key: REFUND_KEY, reason });
    }
  });
  it("takes the token from the chain config, never from input, and refuses a cap that is not positive", () => {
    expect(buildDirectory(facts({ chainId: 1, usdt: "0x0000000000000000000000000000000000000001" })).records[TOKEN_KEY]).toBe("eip155:1/erc20:0x0000000000000000000000000000000000000001");
    const r = buildDirectory(facts({ perInvoice: 0n }));
    expect(r.records[LIMITS_KEY]).toBeUndefined();
    expect(r.omitted).toContainEqual({ key: LIMITS_KEY, reason: "no_cap" });
  });
});

describe("diffDirectory", () => {
  const next = { [PAY_KEY]: "https://a.example/p", [TOKEN_KEY]: "t" };
  it("writes everything the first time", () => {
    expect(diffDirectory({}, next)).toEqual(next);
  });
  it("writes only what changed, and nothing when nothing changed", () => {
    expect(diffDirectory(next, next)).toEqual({});
    expect(diffDirectory(next, { ...next, [PAY_KEY]: "https://a.example/q" })).toEqual({ [PAY_KEY]: "https://a.example/q" });
  });
  it("blanks a record that was published and is no longer wanted", () => {
    expect(diffDirectory(next, { [TOKEN_KEY]: "t" })).toEqual({ [PAY_KEY]: "" });
  });
  it("ignores keys outside the directory in the prior state", () => {
    expect(diffDirectory({ "stenmont.tier": "3" }, {})).toEqual({});
  });
});
