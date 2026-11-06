import { describe, expect, it } from "vitest";
import { toUsdtAmount } from "../src/money";

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e: any) {
    return e.code;
  }
};

describe("toUsdtAmount", () => {
  it("takes USD one to one and ignores any rate", () => {
    expect(toUsdtAmount("12.5", "USD")).toBe("12.50");
    expect(toUsdtAmount("12.5", "USD", "99")).toBe("12.50");
  });
  it("requires a rate for other currencies and never invents one", () => {
    expect(code(() => toUsdtAmount("100.00", "INR"))).toBe("needs_rate");
    expect(code(() => toUsdtAmount("100.00", "INR", ""))).toBe("needs_rate");
    expect(code(() => toUsdtAmount("100.00", "INR", "abc"))).toBe("needs_rate");
    expect(code(() => toUsdtAmount("100.00", "INR", "0"))).toBe("needs_rate");
    expect(code(() => toUsdtAmount("100.00", "INR", "-5"))).toBe("needs_rate");
  });
  it("converts with the owner's rate", () => {
    expect(toUsdtAmount("8350.00", "INR", "83.5")).toBe("100.00");
  });
  it("rounds half up to 6 decimals", () => {
    // 1 / 3 = 0.333333.. -> 0.333333; 2 / 3 = 0.666666.. -> 0.666667
    expect(toUsdtAmount("1", "EUR", "3")).toBe("0.333333");
    expect(toUsdtAmount("2", "EUR", "3")).toBe("0.666667");
    // exactly half: 0.000001 / 2 = 0.0000005 -> rounds up to 0.000001
    expect(toUsdtAmount("0.000001", "EUR", "2")).toBe("0.000001");
    // just under half rounds down to zero -> too small
    expect(code(() => toUsdtAmount("0.000001", "EUR", "2.000001"))).toBe("amount_too_small");
  });
  it("rejects zero, negative and malformed amounts", () => {
    for (const bad of ["0", "0.00", "-1", "1e3", "abc", "", " 5", "1,5", "1.1234567", "NaN"]) expect(code(() => toUsdtAmount(bad, "USD"))).toBe("bad_amount");
  });
  it("rejects overflowing amounts and absurd results", () => {
    expect(code(() => toUsdtAmount("9".repeat(16), "USD"))).toBe("bad_amount");
    expect(code(() => toUsdtAmount("999999999999999", "USD"))).toBe("amount_too_large");
    expect(code(() => toUsdtAmount("999999999999", "EUR", "0.000001"))).toBe("amount_too_large");
  });
  it("rejects a bad currency code", () => {
    expect(code(() => toUsdtAmount("1", "usd"))).toBe("bad_currency");
    expect(code(() => toUsdtAmount("1", "US"))).toBe("bad_currency");
  });
});
