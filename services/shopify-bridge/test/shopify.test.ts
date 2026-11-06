import { describe, expect, it } from "vitest";
import { checkUserErrors, isShopDomain, makeShopify, toGid } from "../src/shopify";
import { bearerOk, safeEqual, verifyShopifyHmac } from "../src/util";
import { deps, fake, type Call } from "./helpers";

const mk = (shop: string, d = deps(() => Response.json({ data: { ok: 1 } }))) => makeShopify({ shop, token: fake("admin"), fetch: d.fetch, sleep: d.sleep });

describe("shop domain", () => {
  it("accepts only name.myshopify.com", () => {
    expect(isShopDomain("demo-shop.myshopify.com")).toBe(true);
    for (const bad of ["evil.com", "demo.myshopify.com.evil.com", "a.b.myshopify.com", "demo.myshopify.com:8080", "demo.myshopify.com/x", "user@demo.myshopify.com", "-x.myshopify.com", "Demo.myshopify.com", "127.0.0.1", "", "demo.myshopify.com\n"]) expect(isShopDomain(bad)).toBe(false);
  });
  it("refuses to build a client for a bad shop, so the token cannot be sent anywhere else", () => {
    expect(() => mk("evil.com")).toThrow(/myshopify/);
  });
});

describe("Admin client", () => {
  it("sends the token only to https://{shop}/admin/api/..., never follows redirects, and returns data", async () => {
    const calls: Call[] = [];
    const s = mk("demo-shop.myshopify.com", deps(() => Response.json({ data: { a: 1 } }), calls));
    expect(await s.gql("query { a }")).toEqual({ a: 1 });
    expect(calls[0]!.url).toMatch(/^https:\/\/demo-shop\.myshopify\.com\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/);
    expect(calls[0]!.redirect).toBe("manual");
    expect(calls[0]!.headers.get("x-shopify-access-token")).toBe(fake("admin"));
  });
  it("treats a redirect as an error and does not leak the token or upstream text", async () => {
    const s = mk("demo-shop.myshopify.com", deps(() => new Response("secret upstream text", { status: 302, headers: { location: "https://evil.example" } })));
    const e: any = await s.gql("query { a }").catch((x) => x);
    expect(e.code).toBe("shopify_redirect");
    expect(`${e.message}`).not.toContain(fake("admin"));
    expect(`${e.message}`).not.toContain("upstream");
  });
  it("maps 401 and 5xx without copying upstream text", async () => {
    expect(((await mk("demo-shop.myshopify.com", deps(() => new Response("nope", { status: 401 }))).gql("q").catch((x) => x)) as any).code).toBe("shopify_denied");
    expect(((await mk("demo-shop.myshopify.com", deps(() => new Response("boom", { status: 500 }))).gql("q").catch((x) => x)) as any).code).toBe("shopify_error");
  });
  it("waits and retries when Shopify says THROTTLED", async () => {
    let n = 0;
    const slept: number[] = [];
    const d = deps(() => (n++ < 2 ? Response.json({ errors: [{ extensions: { code: "THROTTLED" } }], extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } } }) : Response.json({ data: { ok: true } })));
    d.sleep = async (ms) => void slept.push(ms);
    expect(await makeShopify({ shop: "demo-shop.myshopify.com", token: fake("admin"), fetch: d.fetch, sleep: d.sleep }).gql("q")).toEqual({ ok: true });
    expect(slept).toEqual([2000, 2000]);
  });
  it("gives up after a few throttles", async () => {
    const s = mk("demo-shop.myshopify.com", deps(() => new Response("", { status: 429 })));
    expect(((await s.gql("q").catch((x) => x)) as any).code).toBe("shopify_throttled");
  });
  it("turns userErrors into a 422", () => {
    expect(() => checkUserErrors({ userErrors: [{ message: "Add at least 1 product" }] })).toThrow(/Add at least 1 product/);
    expect(() => checkUserErrors({ userErrors: [] })).not.toThrow();
  });
});

describe("ids", () => {
  it("accepts numeric ids and global ids of the right kind only", () => {
    expect(toGid("DraftOrder", "123")).toBe("gid://shopify/DraftOrder/123");
    expect(toGid("ProductVariant", 77)).toBe("gid://shopify/ProductVariant/77");
    expect(toGid("DraftOrder", "gid://shopify/DraftOrder/9")).toBe("gid://shopify/DraftOrder/9");
    for (const bad of ["gid://shopify/Order/9", "abc", "1 2", "1; drop", "", null, {}, "gid://shopify/DraftOrder/9/extra"]) expect(() => toGid("DraftOrder", bad)).toThrow();
  });
});

describe("crypto helpers", () => {
  it("safeEqual and bearerOk", async () => {
    expect(await safeEqual("a", "a")).toBe(true);
    expect(await safeEqual("a", "b")).toBe(false);
    expect(await safeEqual("a", "aa")).toBe(false);
    expect(await bearerOk("Bearer tok", "tok")).toBe(true);
    expect(await bearerOk("Bearer nope", "tok")).toBe(false);
    expect(await bearerOk(undefined, "tok")).toBe(false);
    expect(await bearerOk("Bearer ", "")).toBe(false);
  });
  it("verifyShopifyHmac checks base64 HMAC-SHA256 of the raw body", async () => {
    const secret = fake("s");
    const body = '{"id":1}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
    expect(await verifyShopifyHmac(secret, body, sig)).toBe(true);
    expect(await verifyShopifyHmac(secret, body + " ", sig)).toBe(false);
    expect(await verifyShopifyHmac("other", body, sig)).toBe(false);
    expect(await verifyShopifyHmac(secret, body, "not base64!!")).toBe(false);
    expect(await verifyShopifyHmac(secret, body, undefined)).toBe(false);
  });
});
