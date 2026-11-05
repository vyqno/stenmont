import { describe, expect, it } from "vitest";
import { invoiceId } from "../src/ids";

const merchant = "0x50c94c3021962047F10c9c58D80C4A7b73182a63";

describe("invoiceId", () => {
  it("is stable for the same merchant and number", () => {
    expect(invoiceId(merchant, "INV-1")).toBe(invoiceId(merchant, "INV-1"));
  });
  it("differs for a different number or merchant", () => {
    expect(invoiceId(merchant, "INV-1")).not.toBe(invoiceId(merchant, "INV-2"));
    expect(invoiceId(merchant, "INV-1")).not.toBe(
      invoiceId("0xe4F5853650f40f04e920c62F6dE9e4e38D767B66", "INV-1"),
    );
  });
  it("is a 32-byte hex string", () => {
    expect(invoiceId(merchant, "INV-1")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
