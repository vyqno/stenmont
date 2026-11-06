import { describe, expect, it } from "vitest";
import { buildBody, formatReport, parseConfig, readCsvDir, scrub, UsageError } from "./shopify-import-lib";

const KEY = "sk_test_" + "a".repeat(32);
const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");
const env = { STENMONT_API_KEY: KEY, SHOPIFY_SHOP_DOMAIN: "demo.myshopify.com", SHOPIFY_ADMIN_TOKEN: TOKEN };
const url = ["--api-url", "https://api-staging.stenmont.com/"];

describe("parseConfig", () => {
  it("uses the Admin API when the shop and token are in the environment, and previews by default", () => {
    const c = parseConfig(url, env);
    expect(c).toMatchObject({ mode: "api", shop: "demo.myshopify.com", token: TOKEN, apiUrl: "https://api-staging.stenmont.com", confirm: false, includeCustomers: false });
  });
  it("uses CSV files with --csv-dir and takes the flags", () => {
    const c = parseConfig(["--csv-dir", "/tmp/x", ...url, "--confirm", "--include-customers", "--currency", "eur", "--rate", "1.08"], { STENMONT_API_KEY: KEY });
    expect(c).toMatchObject({ mode: "csv", csvDir: "/tmp/x", confirm: true, includeCustomers: true, currency: "EUR", rate: "1.08" });
  });
  it("needs an API url and a key, and refuses insecure or production addresses", () => {
    expect(() => parseConfig([], env)).toThrow(/--api-url/);
    expect(() => parseConfig(url, {})).toThrow(/STENMONT_API_KEY/);
    expect(() => parseConfig(["--api-url", "http://api.example.com"], env)).toThrow(/https/);
    expect(() => parseConfig(["--api-url", "https://api.stenmont.com"], env)).toThrow(/production/);
    expect(() => parseConfig(["--api-url", "http://localhost:8787"], env)).not.toThrow();
  });
  it("refuses an ambiguous or incomplete source", () => {
    expect(() => parseConfig(["--csv-dir", "/tmp/x", ...url], env)).toThrow(/Choose one/);
    expect(() => parseConfig(url, { STENMONT_API_KEY: KEY })).toThrow(/--csv-dir/);
    expect(() => parseConfig(url, { ...env, SHOPIFY_SHOP_DOMAIN: "evil.com" })).toThrow(/myshopify/);
  });
  it("has no flag that would carry a secret on the command line", () => {
    expect(() => parseConfig([...url, "--token", TOKEN], env)).toThrow(/Unknown flag/);
    expect(() => parseConfig([...url, "--api-key", KEY], env)).toThrow(/Unknown flag/);
  });
  it("rejects stray arguments and flags missing a value", () => {
    expect(() => parseConfig([...url, "oops"], env)).toThrow(UsageError);
    expect(() => parseConfig(["--api-url"], env)).toThrow(/needs a value/);
  });
});

describe("readCsvDir", () => {
  const disk: Record<string, string> = { "/d/products_export.csv": "p", "/d/customers_export.csv": "c", "/d/orders_export.csv": "o" };
  const read = (p: string) => disk[p] ?? null;
  it("does not even open customers or orders unless asked", () => {
    const opened: string[] = [];
    expect(readCsvDir("/d/", false, (p) => (opened.push(p), read(p)))).toEqual({ products: "p" });
    expect(opened).toEqual(["/d/products_export.csv"]);
  });
  it("reads them with --include-customers, and complains when none exists", () => {
    expect(readCsvDir("/d", true, read)).toEqual({ products: "p", customers: "c", orders: "o" });
    expect(() => readCsvDir("/d", true, (p) => (p.includes("products") ? "p" : null))).toThrow(/customers_export/);
    expect(() => readCsvDir("/empty", false, () => null)).toThrow(/products_export/);
  });
});

describe("buildBody", () => {
  it("adds confirm only for the commit and keeps the token out of CSV requests", () => {
    const api = parseConfig(url, env);
    expect(buildBody(api, null, false)).toEqual({ source: "api", shop: "demo.myshopify.com", token: TOKEN, includeCustomers: false });
    expect(buildBody(api, null, true)).toMatchObject({ confirm: true });
    const csv = parseConfig(["--csv-dir", "/d", ...url], { STENMONT_API_KEY: KEY });
    expect(JSON.stringify(buildBody(csv, { products: "p" }, false))).not.toContain(KEY);
    expect(buildBody(csv, { products: "p" }, false)).toMatchObject({ source: "csv", currency: "USD" });
  });
});

describe("formatReport", () => {
  const report = {
    source: "api", currency: "USD", rate: "1", includeCustomers: true,
    counts: { products: 5, variants: 7, images: 3, collections: 1, customers: 3, orders: 2 },
    plan: { productsToCreate: 4, productsToUpdate: 1, productsSkipped: 0 },
    warnings: [{ code: "gift_card", message: "Gift cards are not migrated.", count: 1 }],
    unsupported: ["Discount codes"],
    customers: [{ email: "ada@example.test", firstName: "Ada" }],
    token: TOKEN,
  };
  it("prints counts, warnings and the not-migrated list", () => {
    const text = formatReport(report).join("\n");
    expect(text).toContain("products 5 (new 4, update 1, skipped 0)");
    expect(text).toContain("customers 3   past orders 2");
    expect(text).toContain("Gift cards are not migrated. (1)");
    expect(text).toContain("Discount codes");
  });
  it("never prints fields it does not know, such as names, emails or tokens", () => {
    const text = formatReport(report).join("\n");
    for (const s of ["ada@example.test", "Ada", TOKEN]) expect(text).not.toContain(s);
  });
  it("survives a malformed report", () => {
    expect(() => formatReport(null)).not.toThrow();
    expect(() => formatReport({ counts: { products: "x" }, warnings: [null] })).not.toThrow();
  });
});

describe("scrub", () => {
  it("removes every secret from text", () => {
    expect(scrub(`bad ${TOKEN} and ${KEY} and ${TOKEN}`, [TOKEN, KEY, undefined])).toBe("bad *** and *** and ***");
  });
});
