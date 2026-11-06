import { describe, expect, it } from "vitest";
import { connectedRequest, connectProblem, connectRequest, isShopifyConsentUrl, returnFromShopify, shopFromName } from "../lib/shopifyConnect";

describe("shopFromName", () => {
  it("turns a bare store name into its address", () => {
    expect(shopFromName("demo")).toBe("demo.myshopify.com");
    expect(shopFromName(" Demo-Store ")).toBe("demo-store.myshopify.com");
  });
  it("accepts a pasted address or admin link", () => {
    expect(shopFromName("demo.myshopify.com")).toBe("demo.myshopify.com");
    expect(shopFromName("https://Demo.myshopify.com/admin/products")).toBe("demo.myshopify.com");
  });
  it("refuses anything that is not a Shopify store", () => {
    for (const bad of ["", "   ", "evil.com", "demo.myshopify.com.evil.com", "demo.myshopify.com@evil.com", "a.b.myshopify.com", "127.0.0.1", "de mo", "-demo"]) expect(shopFromName(bad)).toBeNull();
  });
});

describe("connectProblem / connectRequest", () => {
  it("asks for a store name and then lets the form go", () => {
    expect(connectProblem("")).toMatch(/store name/);
    expect(connectProblem("evil.com")).toMatch(/store name/);
    expect(connectProblem("demo")).toBeNull();
  });
  it("sends only the shop and the customers choice, never a token", () => {
    expect(connectRequest("Demo", false)).toEqual({ shop: "demo.myshopify.com", includeCustomers: false });
    expect(connectRequest("demo", true)).toEqual({ shop: "demo.myshopify.com", includeCustomers: true });
  });
});

describe("isShopifyConsentUrl", () => {
  it("only lets the browser go to a Shopify authorize page over https", () => {
    expect(isShopifyConsentUrl("https://demo.myshopify.com/admin/oauth/authorize?client_id=x&state=y")).toBe(true);
    for (const bad of ["http://demo.myshopify.com/admin/oauth/authorize", "https://evil.com/admin/oauth/authorize", "https://demo.myshopify.com.evil.com/admin/oauth/authorize", "https://demo.myshopify.com/other", "javascript:alert(1)", "//demo.myshopify.com/admin/oauth/authorize", "", "not a url"]) expect(isShopifyConsentUrl(bad)).toBe(false);
  });
});

describe("returnFromShopify", () => {
  it("recognises a successful connection", () => expect(returnFromShopify("?connected=shopify")).toEqual({ kind: "connected" }));
  it("turns a known error code into plain words", () => {
    const r = returnFromShopify("?shopify_error=scope_missing");
    expect(r).toMatchObject({ kind: "error" });
    expect((r as { message: string }).message).toMatch(/permission/);
  });
  it("never shows an unknown code or anything injected as is", () => {
    const r = returnFromShopify("?shopify_error=%3Cscript%3Ealert(1)%3C%2Fscript%3E") as { kind: string; message: string };
    expect(r.kind).toBe("error");
    expect(r.message).not.toContain("script");
  });
  it("is null when there is nothing to react to", () => {
    expect(returnFromShopify("")).toBeNull();
    expect(returnFromShopify("?connected=other")).toBeNull();
    expect(returnFromShopify("?utm=1")).toBeNull();
  });
});

describe("connectedRequest", () => {
  it("names the shop and sends the rate only when there is one", () => {
    expect(connectedRequest("demo.myshopify.com", "", false)).toEqual({ source: "connected", shop: "demo.myshopify.com" });
    expect(connectedRequest("demo.myshopify.com", " 1.08 ", false)).toEqual({ source: "connected", shop: "demo.myshopify.com", rate: "1.08" });
  });
  it("adds confirm for the commit only", () => {
    expect(connectedRequest("demo.myshopify.com", "", true)).toMatchObject({ confirm: true });
    expect(connectedRequest("demo.myshopify.com", "", false)).not.toHaveProperty("confirm");
  });
});
