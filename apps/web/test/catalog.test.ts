import { describe, expect, it } from "vitest";
import { buildImportRequest, describeReport, formProblem, importMessage, normalizeShop, productSummary, warningLine, type ImportForm, type Report } from "../lib/catalog";

const form = (o: Partial<ImportForm> = {}): ImportForm => ({ source: "csv", currency: "USD", rate: "", includeCustomers: false, files: { products: "csv" }, shop: "", token: "", ...o });
const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");

describe("normalizeShop", () => {
  it("accepts a shop address however it was pasted", () => {
    expect(normalizeShop("Demo-Store.myshopify.com")).toBe("demo-store.myshopify.com");
    expect(normalizeShop("https://demo.myshopify.com/admin/products?x=1")).toBe("demo.myshopify.com");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "evil.com", "demo.myshopify.com.evil.com", "demo.myshopify.com@evil.com", "a.b.myshopify.com", "127.0.0.1"]) expect(normalizeShop(bad)).toBeNull();
  });
});

describe("formProblem", () => {
  it("passes a complete dollar CSV form", () => expect(formProblem(form())).toBeNull());
  it("needs a products file and a currency", () => {
    expect(formProblem(form({ files: {} }))).toMatch(/products file/);
    expect(formProblem(form({ currency: "" }))).toMatch(/currency/);
  });
  it("needs a rate when the currency is not USD", () => {
    expect(formProblem(form({ currency: "eur" }))).toMatch(/never guess/);
    expect(formProblem(form({ currency: "eur", rate: "0" }))).toMatch(/never guess/);
    expect(formProblem(form({ currency: "eur", rate: "1.08" }))).toBeNull();
  });
  it("does not accept 'include customers' without a customers or orders file", () => {
    expect(formProblem(form({ includeCustomers: true }))).toMatch(/customers or orders/);
    expect(formProblem(form({ includeCustomers: true, files: { products: "x", orders: "y" } }))).toBeNull();
  });
  it("checks the shop and token for the API route", () => {
    const api = form({ source: "api", files: {} });
    expect(formProblem(api)).toMatch(/shop address/);
    expect(formProblem({ ...api, shop: "demo.myshopify.com" })).toMatch(/token/);
    expect(formProblem({ ...api, shop: "demo.myshopify.com", token: TOKEN })).toBeNull();
    expect(formProblem({ ...api, shop: "demo.myshopify.com", token: TOKEN, rate: "abc" })).toMatch(/rate/);
  });
});

describe("buildImportRequest", () => {
  it("sends a CSV request without any Shopify token", () => {
    const r = buildImportRequest(form({ token: TOKEN, shop: "x.myshopify.com" }));
    expect(r).toEqual({ source: "csv", currency: "USD", files: { products: "csv" }, includeCustomers: false });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("adds confirm only for the commit", () => {
    expect(buildImportRequest(form(), false)).not.toHaveProperty("confirm");
    expect(buildImportRequest(form(), true)).toMatchObject({ confirm: true });
  });
  it("normalises the shop and trims the token for the API route", () => {
    expect(buildImportRequest(form({ source: "api", shop: "https://Demo.myshopify.com/", token: ` ${TOKEN} `, rate: " 1.1 " }))).toEqual({ source: "api", shop: "demo.myshopify.com", token: TOKEN, includeCustomers: false, rate: "1.1" });
  });
});

const report: Report = {
  source: "csv", currency: "EUR", rate: "1.08",
  counts: { products: 5, variants: 7, images: 3, collections: 1, customers: 3, orders: 2 },
  plan: { productsToCreate: 4, productsToUpdate: 1, productsSkipped: 1 },
  includeCustomers: true, warnings: [], unsupported: [],
};
describe("describeReport", () => {
  it("says what will happen in sentences", () => {
    const text = describeReport(report).join(" ");
    expect(text).toContain("4 new products and 1 product to update, with 7 variants and 3 images");
    expect(text).toContain("1 product skipped");
    expect(text).toContain("1 collection");
    expect(text).toContain("3 customers and 2 past orders");
    expect(text).toContain("1 EUR = 1.08 USDT");
  });
  it("handles dollars and a customer-free import", () => {
    const text = describeReport({ ...report, currency: "USD", rate: "1", includeCustomers: false, plan: { productsToCreate: 1, productsToUpdate: 0, productsSkipped: 0 } }).join(" ");
    expect(text).toContain("1 new product and 0 products");
    expect(text).toContain("one to one");
    expect(text).toContain("Customers and past orders are not included");
  });
});

describe("messages and summaries", () => {
  it("maps known codes and falls back to the server's words", () => {
    expect(importMessage("needs_rate", "x")).toMatch(/rate/);
    expect(importMessage("weird", "server said this")).toBe("server said this");
    expect(warningLine({ message: "Careful", count: 3 })).toBe("Careful (3)");
    expect(warningLine({ message: "Careful", count: 1 })).toBe("Careful");
  });
  it("summarises price range and stock", () => {
    expect(productSummary([{ price: "10", inventory: 2, trackInventory: true }, { price: "25.5", inventory: 5, trackInventory: true }])).toBe("$10.00 to $25.50 · 7 in stock");
    expect(productSummary([{ price: "10", inventory: 0, trackInventory: true }])).toBe("$10.00 · sold out");
    expect(productSummary([{ price: "10", inventory: 0, trackInventory: false }])).toBe("$10.00 · always available");
    expect(productSummary([])).toBe("No variants");
  });
});
