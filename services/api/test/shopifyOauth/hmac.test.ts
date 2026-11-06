import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyQuery } from "../../src/shopifyOauth/hmac";

const SECRET = "fixture-client-secret-0123456789";
const sign = (message: string, secret = SECRET) => createHmac("sha256", secret).update(message).digest("hex");

describe("verifyShopifyQuery", () => {
  it("accepts the documented message: all params but hmac, sorted, k=v joined with &", async () => {
    const q = `shop=a.myshopify.com&code=abc&state=xyz&timestamp=1700000000&host=YWJj`;
    const hmac = sign("code=abc&host=YWJj&shop=a.myshopify.com&state=xyz&timestamp=1700000000");
    expect(await verifyShopifyQuery(new URLSearchParams(`${q}&hmac=${hmac}`), SECRET)).toBe(true);
  });

  it("covers parameters we do not know about", async () => {
    const hmac = sign("code=abc&extra=1&shop=a.myshopify.com");
    expect(await verifyShopifyQuery(new URLSearchParams(`code=abc&shop=a.myshopify.com&extra=1&hmac=${hmac}`), SECRET)).toBe(true);
    expect(await verifyShopifyQuery(new URLSearchParams(`code=abc&shop=a.myshopify.com&extra=2&hmac=${hmac}`), SECRET)).toBe(false);
  });

  it("encodes % and & inside values as Shopify documents (and = inside keys)", async () => {
    const hmac = sign("a%26b=1%25&shop=s");
    const p = new URLSearchParams();
    p.set("a&b", "1%");
    p.set("shop", "s");
    p.set("hmac", hmac);
    // keys: & -> %26 ; values: % -> %25
    expect(await verifyShopifyQuery(p, SECRET)).toBe(true);
  });

  it("refuses a missing, empty, short, non-hex, uppercase-tampered or wrong hmac", async () => {
    const good = sign("code=abc&shop=a.myshopify.com");
    const base = "code=abc&shop=a.myshopify.com";
    for (const h of [undefined, "", "00", "z".repeat(64), sign("code=abd&shop=a.myshopify.com"), good.slice(0, 63), `${good}0`]) {
      expect(await verifyShopifyQuery(new URLSearchParams(h === undefined ? base : `${base}&hmac=${h}`), SECRET)).toBe(false);
    }
    expect(await verifyShopifyQuery(new URLSearchParams(`${base}&hmac=${good}`), `${SECRET}x`)).toBe(false);
  });

  it("refuses repeated parameters (including a second hmac)", async () => {
    const good = sign("code=abc&shop=a.myshopify.com");
    expect(await verifyShopifyQuery(new URLSearchParams(`code=abc&code=abc&shop=a.myshopify.com&hmac=${good}`), SECRET)).toBe(false);
    expect(await verifyShopifyQuery(new URLSearchParams(`code=abc&shop=a.myshopify.com&hmac=${good}&hmac=${good}`), SECRET)).toBe(false);
  });
});
