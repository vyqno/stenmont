import { describe, expect, it } from "vitest";
import { formatUSDT, fromUnits, toUnits } from "../src/money";

describe("money", () => {
  it("parses decimal strings to base units", () => {
    expect(toUnits("12.50")).toBe(12_500_000n);
    expect(toUnits("1")).toBe(1_000_000n);
    expect(toUnits("0.000001")).toBe(1n);
  });
  it("formats base units back", () => {
    expect(fromUnits(12_500_000n)).toBe("12.5");
    expect(fromUnits(1_000_000n)).toBe("1");
    expect(fromUnits(1n)).toBe("0.000001");
  });
  it("formats dollars with two decimals minimum", () => {
    expect(formatUSDT(12_500_000n)).toBe("$12.50");
    expect(formatUSDT(1n)).toBe("$0.000001");
  });
  it("rejects more than 6 decimals, empty and negative", () => {
    expect(() => toUnits("1.1234567")).toThrow();
    expect(() => toUnits("")).toThrow();
    expect(() => toUnits("-1")).toThrow();
    expect(() => toUnits("1e3")).toThrow();
  });
});
