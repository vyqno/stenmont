import { describe, expect, it } from "vitest";
import { BUSINESS_GRANTED_KEYS, DIRECTORY_KEYS, LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, X402_KEY, limitsRecord, parseHttpsUrl, parseLimitsRecord, parseTokenRecord, tokenRecord } from "../src";
import { USDT_ADDRESS } from "../src/chains";

describe("directory keys", () => {
  it("are the five documented stenmont.* keys and none is ever granted to a business-side account", () => {
    expect([...DIRECTORY_KEYS].sort()).toEqual(["stenmont.limits", "stenmont.pay", "stenmont.refund", "stenmont.token", "stenmont.x402"]);
    expect([PAY_KEY, X402_KEY, TOKEN_KEY, REFUND_KEY, LIMITS_KEY]).toEqual(expect.arrayContaining([...DIRECTORY_KEYS]));
    for (const k of DIRECTORY_KEYS) expect(BUSINESS_GRANTED_KEYS).not.toContain(k);
  });
});

describe("token record", () => {
  it("is derived, not free text: chain and token address", () => {
    expect(tokenRecord()).toBe(`eip155:1874/erc20:${USDT_ADDRESS}`);
  });
  it("round-trips and rejects anything malformed", () => {
    expect(parseTokenRecord(tokenRecord())).toEqual({ chainId: 1874, address: USDT_ADDRESS });
    for (const bad of ["", "USDT", "eip155:1874/erc20:0x123", `eip155:1874/erc721:${USDT_ADDRESS}`, `eip155:abc/erc20:${USDT_ADDRESS}`, ` eip155:1874/erc20:${USDT_ADDRESS}`, `eip155:1874/erc20:${USDT_ADDRESS}/x`]) {
      expect(parseTokenRecord(bad)).toBeNull();
    }
  });
});

describe("limits record", () => {
  it("round-trips a per-invoice cap", () => {
    expect(JSON.parse(limitsRecord(2_000_000_000n))).toEqual({ perInvoice: "2000", unit: "USDT" });
    expect(parseLimitsRecord(limitsRecord(2_500_000n))).toEqual({ perInvoice: 2_500_000n });
  });
  it("refuses zero, negative, absurd, extra-field and non-JSON values", () => {
    for (const bad of ["", "{}", "nope", '{"perInvoice":"0","unit":"USDT"}', '{"perInvoice":"-1","unit":"USDT"}', '{"perInvoice":"1e3","unit":"USDT"}', '{"perInvoice":"5000000000","unit":"USDT"}', '{"perInvoice":"5","unit":"DAI"}', '{"perInvoice":"5","unit":"USDT","x":1}', '{"perInvoice":5,"unit":"USDT"}']) {
      expect(parseLimitsRecord(bad)).toBeNull();
    }
  });
});

describe("parseHttpsUrl", () => {
  it("accepts a plain https address and returns it normalised without a trailing slash", () => {
    expect(parseHttpsUrl("https://shop.example.com/api/pay/")).toBe("https://shop.example.com/api/pay");
    expect(parseHttpsUrl("https://shop.example.com/api?x=1")).toBe("https://shop.example.com/api?x=1");
  });
  it("refuses http, credentials, ports, IP literals, private names, spaces and other schemes", () => {
    for (const bad of ["http://a.example.com", "ftp://a.example.com", "javascript:alert(1)", "https://u:p@a.example.com", "https://a.example.com:8443", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://intranet/x", "https://a.local/x", "https://a.example.com/ x", "", "not a url", "https://" + "a".repeat(2100) + ".com"]) {
      expect(parseHttpsUrl(bad)).toBeNull();
    }
  });
});
