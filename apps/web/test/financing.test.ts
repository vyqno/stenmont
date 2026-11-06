import { describe, expect, it } from "vitest";
import { b64urlToHex, describeReputation, financingMessage, formatYield, listingBadge, pctToBps, quoteSale } from "../lib/financing";

describe("quoteSale", () => {
  it("matches the API: price = face*(10000-d)/10000, reserve = face*r/10000, advance = price - reserve", () => {
    expect(quoteSale("1000", "3", "10")).toEqual({ price: "970", reserve: "100", advance: "870" });
    expect(quoteSale("250.00", "3", "10")).toEqual({ price: "242.5", reserve: "25", advance: "217.5" });
  });
  it("rounds both down to the smallest unit", () => {
    // face 0.000001 * 9700/10000 = 0.0000097 -> 0
    expect(quoteSale("0.000001", "3", "0")).toBeNull();
    // face 0.000007: price 6.79 -> 6, reserve 0.7 -> 0
    expect(quoteSale("0.000007", "3", "10")).toEqual({ price: "0.000006", reserve: "0", advance: "0.000006" });
  });
  it("enforces limits", () => {
    expect(quoteSale("100", "30", "50")).not.toBeNull();
    expect(quoteSale("100", "30.01", "10")).toBeNull();
    expect(quoteSale("100", "3", "50.01")).toBeNull();
    expect(quoteSale("100", "0", "10")).toBeNull();
    expect(quoteSale("100", "abc", "10")).toBeNull();
    expect(quoteSale("100", "3", "-1")).toBeNull();
    expect(quoteSale("100", "3", "0")).toEqual({ price: "97", reserve: "0", advance: "97" });
  });
});

describe("pctToBps", () => {
  it("converts percent to basis points", () => {
    expect(pctToBps("3", 0, 30)).toBe(300);
    expect(pctToBps("2.5", 0, 30)).toBe(250);
    expect(pctToBps("0.01", 0.01, 30)).toBe(1);
    expect(pctToBps("3.123", 0, 30)).toBeNull();
    expect(pctToBps("", 0, 30)).toBeNull();
  });
});

describe("b64urlToHex", () => {
  it("turns a base64url digest into 0x hex", () => {
    expect(b64urlToHex("AAECA_8")).toBe("0x00010203ff");
    const hex = `0x${"ab".repeat(32)}`;
    const b64 = btoa(String.fromCharCode(...Array(32).fill(0xab))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    expect(b64urlToHex(b64)).toBe(hex);
  });
  it("handles url-safe characters", () => {
    expect(b64urlToHex("-_8")).toBe("0xfbff");
  });
});

describe("display helpers", () => {
  it("formats yield and reputation", () => {
    expect(formatYield("3.09")).toBe("3.09%");
    expect(describeReputation(null)).toBe("No payment history yet");
    expect(describeReputation({ score: 90, paid: 1 })).toBe("Reliability 90, 1 invoice paid");
    expect(describeReputation({ score: 90, paid: 3 })).toBe("Reliability 90, 3 invoices paid");
  });
  it("maps listing status to badges", () => {
    expect(listingBadge("listed")?.label).toBe("Listed");
    expect(listingBadge("funded")?.label).toBe("Funded");
    expect(listingBadge("settled")?.label).toBe("Settled");
    expect(listingBadge("defaulted")?.label).toBe("Defaulted");
    expect(listingBadge("pending")).toBeNull();
  });
  it("maps error codes to plain words, with no crypto vocabulary", () => {
    expect(financingMessage("not_verified")).toContain("Verify your business");
    expect(financingMessage("nope")).toBe("Something went wrong. Please try again.");
    const all = ["not_verified", "invoice_not_sellable", "already_listed", "duplicate", "not_allowed", "seller_unavailable", "busy", "timeout", "insufficient"].map((c) => financingMessage(c)).join(" ");
    expect(all).not.toMatch(/\b(gas|wallet|seed|chain|token|blockchain)\b/i);
  });
});
