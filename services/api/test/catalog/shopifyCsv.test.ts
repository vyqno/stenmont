import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCustomersCsv, readOrdersCsv, readProductsCsv } from "../../src/import/shopify/csvSources";
import { Warnings } from "../../src/import/shopify/types";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "../fixtures/shopify", name), "utf8");
const winExport = (name: string) => "﻿" + fx(name).replaceAll("\n", "\r\n"); // what Excel-era exports look like

describe("products_export.csv", () => {
  const w = new Warnings();
  const products = readProductsCsv(winExport("products_export.csv"), w);
  const by = (h: string) => products.find((p) => p.handle === h)!;

  it("folds variant and image rows into one product", () => {
    const shirt = by("linen-shirt");
    expect(shirt.title).toBe("Linen Shirt");
    expect(shirt.variants.map((v) => [v.sku, v.options, v.price, v.inventory, v.tracked])).toEqual([
      ["SH-S-BL", { Size: "S", Color: "Blue" }, "1234.50", 5, true],
      ["SH-M-BL", { Size: "M", Color: "Blue" }, "1234.50", 0, true],
      ["SH-L-BL", { Size: "L", Color: "Blue" }, "1234.50", 12, true],
    ]);
    expect(shirt.images.map((i) => [i.url, i.position])).toEqual([
      ["https://cdn.example/linen-front.jpg", 1],
      ["https://cdn.example/linen-side.jpg", 2],
      ["https://cdn.example/linen-back.jpg", 3],
    ]);
    expect(shirt.tags).toEqual(["summer", "linen"]);
    expect(shirt.vendor).toBe("Acme Co");
    expect(shirt.productType).toBe("Shirts");
    expect(shirt.status).toBe("active");
  });
  it("keeps quoted commas and line breaks inside values", () => {
    expect(by("mug").title).toBe('Mug "Classic"');
    expect(by("mug").descriptionHtml).toContain("Line two, with comma");
  });
  it("treats Default Title as a single variant without options, and untracked stock as untracked", () => {
    const v = by("mug").variants[0]!;
    expect(v.options).toEqual({});
    expect(v.tracked).toBe(false);
    expect(v.price).toBe("12.50");
  });
  it("defuses spreadsheet formulas and reports it once", () => {
    const evil = products.find((p) => p.title === "'Evil Title" || p.vendor.startsWith("'@"))!;
    expect(evil.vendor).toBe("'@Vendor");
    expect(evil.variants[0]!.sku).toBe("'+SKU1");
    expect(w.list().find((x) => x.code === "formula_text")!.count).toBeGreaterThanOrEqual(2);
  });
  it("maps draft status and keeps drafts", () => {
    expect(by("secret-draft").status).toBe("draft");
  });
  it("drops a variant with an unreadable price and the product with it", () => {
    expect(products.find((p) => p.handle === "broken-price")).toBeUndefined();
    expect(w.list().map((x) => x.code)).toContain("bad_price");
  });
  it("flags gift cards and subscription-looking items as things that will not work", () => {
    const codes = w.list().map((x) => x.code);
    expect(codes).toContain("gift_card");
    expect(codes).toContain("subscription_tag");
  });
  it("rejects a file without the columns it needs", () => {
    expect(() => readProductsCsv("Name,Thing\nx,y", new Warnings())).toThrowError(/Handle/);
  });
  it("is the same for LF files without a BOM", () => {
    expect(readProductsCsv(fx("products_export.csv"), new Warnings()).map((p) => p.handle)).toEqual(products.map((p) => p.handle));
  });
});

describe("customers_export.csv", () => {
  const w = new Warnings();
  const customers = readCustomersCsv(winExport("customers_export.csv"), w);
  it("keeps only the minimum fields", () => {
    expect(customers[0]).toEqual({ email: "ada@example.test", firstName: "Ada", lastName: "Example", country: "GB", acceptsMarketing: true });
    expect(Object.keys(customers[0]!).sort()).toEqual(["acceptsMarketing", "country", "email", "firstName", "lastName"]);
    const all = JSON.stringify(customers);
    for (const secret of ["Test Street", "+44", "VIP", "120.00", "AB1 2CD"]) expect(all).not.toContain(secret);
  });
  it("lower-cases emails, keeps quotes in names, skips rows without a valid email", () => {
    expect(customers[1]).toMatchObject({ email: "bob@example.test", lastName: "O'Neil, Jr.", acceptsMarketing: false });
    expect(customers.map((c) => c.email)).not.toContain("not-an-email");
    expect(w.list().map((x) => x.code)).toContain("bad_email");
  });
  it("defuses formulas in names", () => {
    expect(customers.find((c) => c.email === "evil@example.test")!.firstName).toBe("'=Evil");
  });
});

describe("orders_export.csv", () => {
  const orders = readOrdersCsv(winExport("orders_export.csv"), new Warnings());
  it("folds line-item rows and reads totals with thousands separators", () => {
    expect(orders).toEqual([
      { name: "#1001", email: "ada@example.test", financialStatus: "paid", fulfillmentStatus: "fulfilled", currency: "EUR", total: "105.00", orderedAt: "2026-10-01T09:55:00.000Z", lineCount: 2 },
      { name: "#1002", email: "bob@example.test", financialStatus: "pending", fulfillmentStatus: "unfulfilled", currency: "EUR", total: "1234.50", orderedAt: "2026-10-03T11:00:00.000Z", lineCount: 1 },
    ]);
  });
  it("never reads addresses, notes or names", () => {
    const all = JSON.stringify(orders);
    for (const secret of ["Test Street", "call me", "Ada Example", "SAVE10"]) expect(all).not.toContain(secret);
  });
});
