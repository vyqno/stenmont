import { describe, expect, it } from "vitest";
import { addToCart, cartCount, cartTotal, checkoutBody, checkoutMessage, formatPrice, loadCart, parseCart, removeFromCart, saveCart, setQuantity, stockLabel, variantName, type Cart } from "../lib/storefront";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
};
const BANNED = /\b(gas|wbt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;

describe("the cart", () => {
  it("adds, merges, changes and removes lines, and holds only ids and quantities", () => {
    let c: Cart = [];
    c = addToCart(c, "var_a", 1);
    c = addToCart(c, "var_b", 2);
    c = addToCart(c, "var_a", 2);
    expect(c).toEqual([{ variantId: "var_a", quantity: 3 }, { variantId: "var_b", quantity: 2 }]);
    expect(cartCount(c)).toBe(5);
    c = setQuantity(c, "var_b", 7);
    expect(c[1]).toEqual({ variantId: "var_b", quantity: 7 });
    expect(setQuantity(c, "var_b", 0)).toEqual([{ variantId: "var_a", quantity: 3 }]);
    expect(removeFromCart(c, "var_a")).toEqual([{ variantId: "var_b", quantity: 7 }]);
    expect(Object.keys(c[0]!).sort()).toEqual(["quantity", "variantId"]);
  });

  it("clamps quantities to a sane range and caps the number of lines", () => {
    expect(addToCart([], "v", 5000)[0]!.quantity).toBe(99);
    expect(addToCart([], "v", -4)).toEqual([]);
    expect(addToCart([], "v", 1.7)[0]!.quantity).toBe(1);
    let c: Cart = [];
    for (let i = 0; i < 60; i++) c = addToCart(c, `v${i}`, 1);
    expect(c).toHaveLength(50);
  });

  it("survives whatever is in storage: junk, wrong shapes, extra fields (prices are dropped)", () => {
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart('{"a":1}')).toEqual([]);
    expect(parseCart('[{"variantId":"v1","quantity":2,"price":"0.01"},{"variantId":5,"quantity":1},{"variantId":"v2","quantity":-1},null]')).toEqual([{ variantId: "v1", quantity: 2 }]);
    expect(parseCart(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }))))).toHaveLength(50);
  });

  it("is kept per shop in session storage, and a blocked storage just means an empty cart", () => {
    const s = memory();
    saveCart(s, "acme", [{ variantId: "v1", quantity: 2 }]);
    expect(loadCart(s, "acme")).toEqual([{ variantId: "v1", quantity: 2 }]);
    expect(loadCart(s, "other")).toEqual([]);
    saveCart(s, "acme", []);
    expect(s.raw.size).toBe(0);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => {} };
    expect(loadCart(broken, "acme")).toEqual([]);
    expect(() => saveCart(broken, "acme", [{ variantId: "v", quantity: 1 }])).not.toThrow();
  });
});

describe("what goes to the server", () => {
  it("is variant ids and quantities and an optional email, never a price or a total", () => {
    const body = checkoutBody([{ variantId: "v1", quantity: 2 }], " buyer@example.com ");
    expect(body).toEqual({ items: [{ variantId: "v1", quantity: 2 }], customerEmail: "buyer@example.com" });
    expect(checkoutBody([{ variantId: "v1", quantity: 2 }], "  ")).toEqual({ items: [{ variantId: "v1", quantity: 2 }] });
    expect(JSON.stringify(body)).not.toMatch(/price|amount|total/i);
  });
});

describe("what is shown", () => {
  const products = [
    { handle: "mug", title: "Mug", variants: [{ id: "v1", title: "Blue", price: "12.5", available: true, options: {} }] },
    { handle: "cap", title: "Cap", variants: [{ id: "v2", title: "Default Title", price: "8", available: false, options: {} }] },
  ];
  it("formats prices in USDT with at least two decimals", () => {
    expect(formatPrice("12.5")).toBe("12.50 USDT");
    expect(formatPrice("8")).toBe("8.00 USDT");
    expect(formatPrice("0.000001")).toBe("0.000001 USDT");
  });
  it("totals for display only (the server prices the order)", () => {
    expect(cartTotal([{ variantId: "v1", quantity: 2 }, { variantId: "v2", quantity: 1 }, { variantId: "gone", quantity: 1 }], products)).toBe("33");
  });
  it("names variants and stock plainly, from the public flag only", () => {
    expect(variantName(products[0]!, products[0]!.variants[0]!)).toBe("Mug - Blue");
    expect(variantName(products[1]!, products[1]!.variants[0]!)).toBe("Cap");
    expect(stockLabel(true)).toBe("In stock");
    expect(stockLabel(false)).toBe("Sold out");
  });
  it("explains every checkout problem without crypto words", () => {
    for (const code of ["variant_unavailable", "out_of_stock", "payments_paused", "rate_limited", "not_found", "invalid_request", "order_too_large", "something_else"]) {
      expect(checkoutMessage(code)).not.toMatch(BANNED);
      expect(checkoutMessage(code).length).toBeGreaterThan(10);
    }
    expect(checkoutMessage("out_of_stock")).toMatch(/stock/i);
    expect(checkoutMessage("payments_paused")).toMatch(/paused/i);
  });
});
