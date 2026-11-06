import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorePreview } from "../app/dashboard/catalog/StoreSettings";
import { sameStore, storeBody, storeErrorText, storeProblems, suggestSlug } from "../lib/storeSettings";

// Sample values for tests only.
const ok = { name: "Acme Coffee", slug: "acme-coffee", displayNote: "Free delivery over $50." };

describe("store settings", () => {
  it("accepts a good store and sends a cleared note as an empty string", () => {
    expect(storeProblems(ok)).toEqual({});
    expect(storeBody({ ...ok, name: "  Acme  ", displayNote: "  " })).toEqual({ slug: "acme-coffee", name: "Acme", displayNote: "" });
  });
  it("mirrors the server's address rule", () => {
    for (const slug of ["ab", "-abc", "abc-", "ABC", "a b c", "x".repeat(41), ""]) expect(storeProblems({ ...ok, slug }).slug, slug).toBeTruthy();
    for (const slug of ["abc", "a-b", "shop-2", "x".repeat(40)]) expect(storeProblems({ ...ok, slug }).slug, slug).toBeUndefined();
  });
  it("limits the name and the note", () => {
    expect(storeProblems({ ...ok, name: " " }).name).toBeTruthy();
    expect(storeProblems({ ...ok, name: "x".repeat(121) }).name).toBeTruthy();
    expect(storeProblems({ ...ok, displayNote: "x".repeat(201) }).displayNote).toMatch(/200/);
    expect(storeProblems({ ...ok, displayNote: "x".repeat(200) }).displayNote).toBeUndefined();
  });
  it("suggests an address from the name that passes the rule", () => {
    expect(suggestSlug("Mary's Coffee & Tea!")).toBe("mary-s-coffee-tea");
    expect(suggestSlug("  ")).toBe("");
    expect(storeProblems({ ...ok, slug: suggestSlug("Café Noir") }).slug).toBeUndefined();
  });
  it("knows when nothing changed", () => {
    expect(sameStore(ok, { ...ok, name: "Acme Coffee " })).toBe(true);
    expect(sameStore(ok, { ...ok, slug: "other-shop" })).toBe(false);
  });
  it("explains a taken address in plain words", () => {
    expect(storeErrorText("slug_taken", "")).toMatch(/already used/);
    expect(storeErrorText(undefined, "")).toMatch(/could not be saved/);
  });
  it("previews the header and the note exactly as the store draws them", () => {
    const html = renderToStaticMarkup(<StorePreview form={ok} />);
    expect(html).toContain("Acme Coffee");
    expect(html).toContain("Cart (0)");
    expect(html).toContain("Payments by Stenmont. Prices are in USDT. Free delivery over $50.");
    expect(renderToStaticMarkup(<StorePreview form={{ name: "", slug: "", displayNote: "" }} />)).toContain("Your store name");
  });
});
