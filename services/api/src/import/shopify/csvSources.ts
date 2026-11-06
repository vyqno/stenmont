import { isEmail, normalHandle, parseBool, parseMoney, safeText, stripQuote } from "./clean";
import { parseCsv } from "./csv";
import { ImportError, type NormCustomer, type NormOrder, type NormProduct, type NormVariant, type Warnings } from "./types";

function need(header: string[], cols: string[], what: string) {
  const missing = cols.filter((c) => !header.includes(c.toLowerCase()));
  if (missing.length) throw new ImportError("wrong_file", `This does not look like Shopify's ${what} export. Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
}

const STATUS = new Set(["active", "draft", "archived"]);

/** products_export.csv: the first row of a product carries its details; later rows add variants (own price and stock) or just another image. */
export function readProductsCsv(text: string, w: Warnings): NormProduct[] {
  const { header, rows } = parseCsv(text);
  need(header, ["Handle", "Title", "Variant Price"], "products");
  const byHandle = new Map<string, NormProduct>();
  const seenVariant = new Set<string>();
  const optionNames = new Map<string, string[]>(); // Shopify names the options only on a product's first row
  for (const r of rows) {
    const rawHandle = (r["handle"] ?? "").trim();
    if (!rawHandle) continue;
    const handle = normalHandle(rawHandle);
    let p = byHandle.get(handle);
    if (!p) {
      if (!(r["title"] ?? "").trim()) {
        w.add("orphan_row", "Some rows had no product above them and were skipped.");
        continue;
      }
      const status = (r["status"] ?? "").trim().toLowerCase();
      p = {
        handle,
        title: safeText(r["title"], w, 200),
        descriptionHtml: r["body (html)"] ?? "",
        vendor: safeText(r["vendor"], w, 120),
        productType: safeText(r["type"], w, 120),
        tags: (r["tags"] ?? "").split(",").map((t) => safeText(t, w, 60)).filter(Boolean),
        status: STATUS.has(status) ? (status as NormProduct["status"]) : parseBool(r["published"]) ? "active" : "draft",
        images: [],
        variants: [],
        collections: [],
      };
      byHandle.set(handle, p);
      if (/gift card/i.test(r["type"] ?? "") || parseBool(r["gift card"])) w.add("gift_card", "Gift cards are not migrated: Stenmont has no gift-card product. They are imported as normal items.");
      if (p.tags.some((t) => /subscri/i.test(t))) w.add("subscription_tag", "Some items are tagged as subscriptions. Subscription plans from Shopify apps are not migrated; create them under Subscriptions.");
    }
    const src = (r["image src"] ?? "").trim();
    if (src) {
      const position = Number.parseInt(r["image position"] ?? "", 10);
      if (!p.images.some((i) => i.url === src)) p.images.push({ url: src, alt: safeText(r["image alt text"], w, 200), position: Number.isFinite(position) && position > 0 ? position : p.images.length + 1 });
    }
    // an image-only row has no price, no SKU and no option value
    const optionValues = [1, 2, 3].map((n) => (r[`option${n} value`] ?? "").trim());
    const sku = safeText(r["variant sku"], w, 80);
    const priceText = (r["variant price"] ?? "").trim();
    if (!priceText && !sku && !optionValues.some(Boolean)) continue;
    const names = optionNames.get(handle) ?? [];
    optionNames.set(handle, names);
    for (const n of [1, 2, 3]) {
      const own = safeText(r[`option${n} name`], w, 40);
      if (own) names[n - 1] = own;
    }
    const price = parseMoney(priceText);
    if (price === null || Number(price) <= 0) {
      w.add("bad_price", "Some variants had a missing, zero or unreadable price and were left out.");
      continue;
    }
    const options: Record<string, string> = {};
    for (const n of [1, 2, 3]) {
      const name = names[n - 1] ?? "";
      const value = safeText(r[`option${n} value`], w, 80);
      if (name && value && !(name === "Title" && value === "Default Title")) options[name] = value;
    }
    const key = `${handle}:${sku || Object.values(options).join("/") || "default"}`;
    if (seenVariant.has(key)) {
      w.add("duplicate_variant", "Some variants repeated an earlier SKU or option set and were skipped.");
      continue;
    }
    seenVariant.add(key);
    const tracked = (r["variant inventory tracker"] ?? "").trim() !== "";
    const qty = Number.parseInt(r["variant inventory qty"] ?? "", 10);
    const v: NormVariant = { key, sku, title: Object.values(options).join(" / "), options, price, inventory: tracked && Number.isFinite(qty) && qty > 0 ? qty : 0, tracked };
    p.variants.push(v);
  }
  const out: NormProduct[] = [];
  for (const p of byHandle.values()) {
    if (p.variants.length === 0) {
      w.add("product_skipped", "Some items had no usable variant and were skipped.");
      continue;
    }
    out.push(p);
  }
  return out;
}

/** customers_export.csv: email, name, country and marketing consent only. */
export function readCustomersCsv(text: string, w: Warnings): NormCustomer[] {
  const { header, rows } = parseCsv(text);
  need(header, ["Email"], "customers");
  const seen = new Set<string>();
  const out: NormCustomer[] = [];
  for (const r of rows) {
    const email = (r["email"] ?? "").trim().toLowerCase();
    if (!isEmail(email)) {
      w.add("bad_email", "Some customers had no valid email and were skipped.");
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      firstName: safeText(r["first name"], w, 80),
      lastName: safeText(r["last name"], w, 80),
      country: (r["default address country code"] ?? r["country code"] ?? "").trim().toUpperCase().slice(0, 2),
      acceptsMarketing: parseBool(r["accepts email marketing"] ?? r["accepts marketing"]),
    });
  }
  return out;
}

/** orders_export.csv: one row per line item; the first row of an order carries the totals. */
export function readOrdersCsv(text: string, w: Warnings): NormOrder[] {
  const { header, rows } = parseCsv(text);
  need(header, ["Name", "Total", "Currency"], "orders");
  const byName = new Map<string, NormOrder>();
  for (const r of rows) {
    const name = stripQuote(r["name"]).slice(0, 40);
    if (!name) continue;
    let o = byName.get(name);
    if (!o) {
      const total = parseMoney(r["total"]);
      if (total === null) {
        w.add("bad_order", "Some orders had an unreadable total and were skipped.");
        continue;
      }
      const t = Date.parse((r["created at"] ?? "").replace(" +0000", "Z").replace(" ", "T"));
      o = {
        name: safeText(name, w, 40),
        email: isEmail((r["email"] ?? "").trim().toLowerCase()) ? (r["email"] ?? "").trim().toLowerCase() : "",
        financialStatus: safeText(r["financial status"], w, 40),
        fulfillmentStatus: safeText(r["fulfillment status"], w, 40),
        currency: (r["currency"] ?? "").trim().toUpperCase().slice(0, 3),
        total,
        orderedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
        lineCount: 0,
      };
      byName.set(name, o);
    }
    if ((r["lineitem name"] ?? "").trim()) o.lineCount++;
  }
  return [...byName.values()];
}
