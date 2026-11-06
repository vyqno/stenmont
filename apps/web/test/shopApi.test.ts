import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProduct } from "../lib/shopApi";

afterEach(() => vi.unstubAllGlobals());

describe("public product API adapter", () => {
  it("maps the API store into the product page's shop model", async () => {
    vi.stubGlobal("fetch", async () => Response.json({
      store: { slug: "proof-shop", name: "Proof shop", displayNote: "Nothing ships" },
      product: { handle: "test-item", title: "Test item", descriptionHtml: "", vendor: "", productType: "", images: [], tags: [], variants: [{ id: "v1", title: "Default", price: "1", available: true, options: {} }] },
    }));
    const result = await fetchProduct("app-staging.stenmont.com", "proof-shop", "test-item");
    expect(result?.shop).toEqual({ slug: "proof-shop", name: "Proof shop", displayNote: "Nothing ships" });
    expect(result?.product.variants[0]?.price).toBe("1");
  });
  it("returns missing for a product that is not public", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    expect(await fetchProduct("app-staging.stenmont.com", "proof-shop", "private")).toBeNull();
  });
});
