import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../app";
import { sanitizeHtml } from "../../catalog/sanitize";
import { collections, importedCustomers, importedOrders, productCollections, productImages, products, variants } from "../../db/schema";
import { sha256Hex } from "../../lib/crypto";
import type { Mapped, Report } from "./map";
import { UNSUPPORTED } from "./map";
import { ImportError } from "./types";

export const SOURCE = "shopify";
const MAX_STATEMENTS = 20_000;
const CHUNK = 40;

/** Same input, same id: that is what makes a re-run update rows instead of adding copies. The merchant is part of the hash, so ids never collide across businesses. */
const rid = async (prefix: string, merchantId: string, ...parts: string[]) => `${prefix}_${(await sha256Hex([SOURCE, merchantId, prefix, ...parts].join("\u0000"))).slice(0, 24)}`;

async function existingIds(db: Db, table: typeof products, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await db.select({ id: table.id }).from(table).where(inArray(table.id, ids.slice(i, i + 90)));
    for (const r of rows) found.add(r.id);
  }
  return found;
}

/** Products that would collide with one the business made by hand (same handle, not from this import). They are skipped, never overwritten. */
async function handleConflicts(db: Db, merchantId: string) {
  const rows = await db
    .select({ handle: products.handle })
    .from(products)
    .where(and(eq(products.merchantId, merchantId), or(isNull(products.externalSource), ne(products.externalSource, SOURCE))));
  return new Set(rows.map((r) => r.handle));
}

export async function plan(db: Db, merchantId: string, m: Mapped, source: "csv" | "api", includeCustomers: boolean): Promise<{ report: Report; creates: Mapped["products"]; ids: Map<string, string> }> {
  const blocked = await handleConflicts(db, merchantId);
  const ids = new Map<string, string>();
  for (const p of m.products) ids.set(p.handle, await rid("prod", merchantId, p.handle));
  const usable = m.products.filter((p) => {
    if (!blocked.has(p.handle)) return true;
    m.warnings.add("handle_conflict", "Some items have the same address as a product you made by hand. They were skipped so yours stay as they are.");
    return false;
  });
  const have = await existingIds(db, products, usable.map((p) => ids.get(p.handle)!));
  const statements = usable.reduce((n, p) => n + 1 + p.variants.length + p.images.length + p.collections.length * 2, 0) + m.customers.length + m.orders.length;
  if (statements > MAX_STATEMENTS) throw new ImportError("too_large", "That is more than one import can hold. Split the files and import in parts.", 422);
  const report: Report = {
    source,
    currency: m.currency,
    rate: m.rate,
    counts: {
      products: usable.length,
      variants: usable.reduce((n, p) => n + p.variants.length, 0),
      images: usable.reduce((n, p) => n + p.images.length, 0),
      collections: m.collections.length,
      customers: includeCustomers ? m.customers.length : 0,
      orders: includeCustomers ? m.orders.length : 0,
    },
    plan: { productsToCreate: usable.filter((p) => !have.has(ids.get(p.handle)!)).length, productsToUpdate: usable.filter((p) => have.has(ids.get(p.handle)!)).length, productsSkipped: m.products.length - usable.length },
    includeCustomers,
    warnings: m.warnings.list(),
    unsupported: UNSUPPORTED,
  };
  return { report, creates: usable, ids };
}

/** Writes the planned rows with upserts keyed on (business, source, external id), in batches. Nothing is ever deleted. */
export async function write(db: Db, merchantId: string, m: Mapped, planned: Awaited<ReturnType<typeof plan>>, includeCustomers: boolean, now: Date) {
  const at = now.toISOString();
  const stmts: BatchItem<"sqlite">[] = [];
  const colId = async (handle: string) => rid("col", merchantId, handle);
  for (const c of m.collections) {
    stmts.push(
      db.insert(collections).values({ id: await colId(c.handle), merchantId, handle: c.handle, title: c.title, externalSource: SOURCE, externalId: c.handle, createdAt: at })
        .onConflictDoUpdate({ target: [collections.merchantId, collections.handle], set: { title: c.title } }),
    );
  }
  for (const p of planned.creates) {
    const id = planned.ids.get(p.handle)!;
    const fields = { title: p.title, descriptionHtml: sanitizeHtml(p.descriptionHtml), vendor: p.vendor, productType: p.productType, status: p.status, tags: JSON.stringify(p.tags), updatedAt: at };
    stmts.push(
      db.insert(products).values({ id, merchantId, handle: p.handle, externalSource: SOURCE, externalId: p.handle, createdAt: at, ...fields })
        .onConflictDoUpdate({ target: [products.merchantId, products.externalSource, products.externalId], set: fields }),
    );
    for (const [n, v] of p.variants.entries()) {
      const vf = { title: v.title, sku: v.sku, price: v.price, inventory: v.inventory, trackInventory: v.tracked ? 1 : 0, options: JSON.stringify(v.options), position: n + 1, updatedAt: at };
      stmts.push(
        db.insert(variants).values({ id: await rid("var", merchantId, v.key), merchantId, productId: id, externalSource: SOURCE, externalId: v.key, createdAt: at, ...vf })
          .onConflictDoUpdate({ target: [variants.merchantId, variants.externalSource, variants.externalId], set: vf }),
      );
    }
    for (const img of p.images) {
      stmts.push(
        db.insert(productImages).values({ id: await rid("img", merchantId, p.handle, img.url), merchantId, productId: id, url: img.url, alt: img.alt, position: img.position })
          .onConflictDoUpdate({ target: [productImages.productId, productImages.url], set: { alt: img.alt, position: img.position } }),
      );
    }
    for (const h of p.collections) stmts.push(db.insert(productCollections).values({ productId: id, collectionId: await colId(h) }).onConflictDoNothing());
  }
  if (includeCustomers) {
    for (const c of m.customers) {
      const f = { email: c.email, firstName: c.firstName, lastName: c.lastName, country: c.country, acceptsMarketing: c.acceptsMarketing ? 1 : 0, updatedAt: at };
      stmts.push(
        db.insert(importedCustomers).values({ id: await rid("cus", merchantId, c.email), merchantId, externalSource: SOURCE, externalId: c.email, createdAt: at, ...f })
          .onConflictDoUpdate({ target: [importedCustomers.merchantId, importedCustomers.externalSource, importedCustomers.externalId], set: f }),
      );
    }
    for (const o of m.orders) {
      const f = { email: o.email, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus, currency: o.currency, total: o.total, lineCount: o.lineCount, orderedAt: o.orderedAt, updatedAt: at };
      stmts.push(
        db.insert(importedOrders).values({ id: await rid("iord", merchantId, o.name), merchantId, externalSource: SOURCE, externalId: o.name, createdAt: at, ...f })
          .onConflictDoUpdate({ target: [importedOrders.merchantId, importedOrders.externalSource, importedOrders.externalId], set: f }),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += CHUNK) await db.batch(stmts.slice(i, i + CHUNK) as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return stmts.length;
}
