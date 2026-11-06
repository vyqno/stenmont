import { and, asc, eq, inArray } from "drizzle-orm";
import { fromUnits } from "@stenmont/shared";
import type { Db } from "../app";
import { productImages, products, variants } from "../db/schema";

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof variants.$inferSelect;
type ImageRow = typeof productImages.$inferSelect;

export const variantView = (v: VariantRow) => ({
  id: v.id,
  title: v.title,
  sku: v.sku,
  price: fromUnits(BigInt(v.price)),
  inventory: v.inventory,
  trackInventory: v.trackInventory === 1,
  options: JSON.parse(v.options) as Record<string, string>,
  position: v.position,
});

/** Joins variants and images onto product rows. Callers pass at most 50 rows (D1 allows 100 bound values per query). */
export async function withChildren(db: Db, merchantId: string, rows: ProductRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const vs = await db.select().from(variants).where(and(eq(variants.merchantId, merchantId), inArray(variants.productId, ids))).orderBy(asc(variants.position), asc(variants.id));
  const imgs = await db.select().from(productImages).where(and(eq(productImages.merchantId, merchantId), inArray(productImages.productId, ids))).orderBy(asc(productImages.position));
  return rows.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor,
    productType: p.productType,
    status: p.status,
    tags: JSON.parse(p.tags) as string[],
    images: imgs.filter((i: ImageRow) => i.productId === p.id).map((i) => ({ url: i.url, alt: i.alt, position: i.position })),
    variants: vs.filter((v) => v.productId === p.id).map(variantView),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}
export type ProductView = Awaited<ReturnType<typeof withChildren>>[number];

/** Only what a shopper needs: no ids of ours, no SKUs, no stock counts, no import bookkeeping. */
export const publicProduct = (p: ProductView) => ({
  handle: p.handle,
  title: p.title,
  descriptionHtml: p.descriptionHtml,
  vendor: p.vendor,
  productType: p.productType,
  tags: p.tags,
  images: p.images,
  variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, options: v.options, available: !v.trackInventory || v.inventory > 0 })),
});
