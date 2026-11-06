import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { sanitizeHtml } from "../catalog/sanitize";
import { productInput, productPatch, slugify, storeInput, variantInput, variantPatch } from "../catalog/schemas";
import { publicProduct, variantView, withChildren } from "../catalog/load";
import { productImages, products, storeSettings, variants } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { invalid } from "../lib/validation";

/** Merchant routes, mounted under /v1. Every query below filters on the caller's merchant id. */
export const catalogRoutes = new Hono<AppEnv>();
const newId = (prefix: string) => `${prefix}_${randomHex(12)}`;
const uniqueViolation = (e: unknown) => /UNIQUE|constraint/i.test(String((e as Error)?.message) + String((e as Error)?.cause ?? ""));

catalogRoutes.get("/store", async (c) => {
  const [s] = await c.var.db.select().from(storeSettings).where(eq(storeSettings.merchantId, c.var.merchantId));
  return s ? c.json({ slug: s.slug, name: s.name }) : fail(c, 404, "not_found", "No store yet");
});

catalogRoutes.put("/store", async (c) => {
  const parsed = storeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const now = c.var.now().toISOString();
  try {
    await c.var.db
      .insert(storeSettings)
      .values({ merchantId: c.var.merchantId, ...parsed.data, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: storeSettings.merchantId, set: { ...parsed.data, updatedAt: now } });
  } catch (e) {
    if (uniqueViolation(e)) return fail(c, 409, "slug_taken", "That store address is taken");
    throw e;
  }
  return c.json(parsed.data);
});

async function ownProduct(c: { var: AppEnv["Variables"] }, id: string) {
  const [row] = await c.var.db.select().from(products).where(and(eq(products.id, id), eq(products.merchantId, c.var.merchantId)));
  return row;
}
const reload = async (c: { var: AppEnv["Variables"] }, id: string) => (await withChildren(c.var.db, c.var.merchantId, [(await ownProduct(c, id))!]))[0]!;

function imageRows(merchantId: string, productId: string, images: { url: string; alt?: string | undefined }[]) {
  return images.map((i, n) => ({ id: newId("img"), merchantId, productId, url: i.url, alt: i.alt ?? "", position: n + 1 }));
}
const variantValues = (v: ReturnType<typeof variantInput.parse>) => ({
  title: v.title ?? "",
  sku: v.sku ?? "",
  price: toUnits(v.price).toString(),
  inventory: v.inventory,
  trackInventory: v.trackInventory ? 1 : 0,
  options: JSON.stringify(v.options ?? {}),
});

catalogRoutes.post("/products", async (c) => {
  const parsed = productInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const input = parsed.data;
  const { db, merchantId } = c.var;
  const now = c.var.now().toISOString();
  const id = newId("prod");
  try {
    await db.insert(products).values({
      id,
      merchantId,
      handle: input.handle ?? slugify(input.title),
      title: input.title,
      descriptionHtml: sanitizeHtml(input.descriptionHtml ?? ""),
      vendor: input.vendor ?? "",
      productType: input.productType ?? "",
      status: input.status ?? "draft",
      tags: JSON.stringify(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    if (uniqueViolation(e)) return fail(c, 409, "handle_taken", "A product with this handle already exists");
    throw e;
  }
  for (const [n, v] of input.variants.entries()) {
    await db.insert(variants).values({ id: newId("var"), merchantId, productId: id, position: n + 1, createdAt: now, updatedAt: now, ...variantValues(v) });
  }
  for (const row of imageRows(merchantId, id, input.images ?? [])) await db.insert(productImages).values(row).onConflictDoNothing();
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "product.created", payload: { id } });
  return c.json(await reload(c, id), 201);
});

catalogRoutes.get("/products", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 25) || 25, 1), 50);
  const after = c.req.query("after");
  const rows = await c.var.db
    .select()
    .from(products)
    .where(after ? and(eq(products.merchantId, c.var.merchantId), gt(products.handle, after)) : eq(products.merchantId, c.var.merchantId))
    .orderBy(asc(products.handle))
    .limit(limit);
  return c.json({ data: await withChildren(c.var.db, c.var.merchantId, rows), next: rows.length === limit ? rows.at(-1)!.handle : null });
});

catalogRoutes.get("/products/:id", async (c) => {
  const row = await ownProduct(c, c.req.param("id"));
  return row ? c.json(await reload(c, row.id)) : fail(c, 404, "not_found", "Product not found");
});

catalogRoutes.patch("/products/:id", async (c) => {
  const parsed = productPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const row = await ownProduct(c, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "Product not found");
  const { images, tags, descriptionHtml, ...rest } = parsed.data;
  const set = {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    ...(descriptionHtml !== undefined ? { descriptionHtml: sanitizeHtml(descriptionHtml) } : {}),
    ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
    updatedAt: c.var.now().toISOString(),
  };
  try {
    await c.var.db.update(products).set(set).where(and(eq(products.id, row.id), eq(products.merchantId, c.var.merchantId)));
  } catch (e) {
    if (uniqueViolation(e)) return fail(c, 409, "handle_taken", "A product with this handle already exists");
    throw e;
  }
  if (images) {
    await c.var.db.delete(productImages).where(and(eq(productImages.productId, row.id), eq(productImages.merchantId, c.var.merchantId)));
    for (const r of imageRows(c.var.merchantId, row.id, images)) await c.var.db.insert(productImages).values(r).onConflictDoNothing();
  }
  return c.json(await reload(c, row.id));
});

/** Deleting archives: orders in progress may still refer to the product's variants. */
catalogRoutes.delete("/products/:id", async (c) => {
  const row = await ownProduct(c, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "Product not found");
  await c.var.db.update(products).set({ status: "archived", updatedAt: c.var.now().toISOString() }).where(and(eq(products.id, row.id), eq(products.merchantId, c.var.merchantId)));
  await audit(c.var.db, { merchantId: c.var.merchantId, actor: `merchant:${c.var.merchantId}`, action: "product.archived", payload: { id: row.id } });
  return c.json({ id: row.id, status: "archived" });
});

catalogRoutes.post("/products/:id/variants", async (c) => {
  const parsed = variantInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const row = await ownProduct(c, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "Product not found");
  const existing = await c.var.db.select({ id: variants.id }).from(variants).where(and(eq(variants.productId, row.id), eq(variants.merchantId, c.var.merchantId)));
  if (existing.length >= 100) return fail(c, 400, "too_many_variants", "A product can have at most 100 variants");
  const now = c.var.now().toISOString();
  const [v] = await c.var.db
    .insert(variants)
    .values({ id: newId("var"), merchantId: c.var.merchantId, productId: row.id, position: existing.length + 1, createdAt: now, updatedAt: now, ...variantValues(parsed.data) })
    .returning();
  return c.json(variantView(v!), 201);
});

catalogRoutes.patch("/variants/:id", async (c) => {
  const parsed = variantPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const d = parsed.data;
  const set = {
    ...(d.title !== undefined ? { title: d.title } : {}),
    ...(d.sku !== undefined ? { sku: d.sku } : {}),
    ...(d.price !== undefined ? { price: toUnits(d.price).toString() } : {}),
    ...(d.inventory !== undefined ? { inventory: d.inventory } : {}),
    ...(d.trackInventory !== undefined ? { trackInventory: d.trackInventory ? 1 : 0 } : {}),
    ...(d.options !== undefined ? { options: JSON.stringify(d.options) } : {}),
    updatedAt: c.var.now().toISOString(),
  };
  const [v] = await c.var.db.update(variants).set(set).where(and(eq(variants.id, c.req.param("id")), eq(variants.merchantId, c.var.merchantId))).returning();
  return v ? c.json(variantView(v)) : fail(c, 404, "not_found", "Variant not found");
});

catalogRoutes.delete("/variants/:id", async (c) => {
  const [v] = await c.var.db.delete(variants).where(and(eq(variants.id, c.req.param("id")), eq(variants.merchantId, c.var.merchantId))).returning({ id: variants.id });
  return v ? c.json({ id: v.id, deleted: true }) : fail(c, 404, "not_found", "Variant not found");
});

// ---------------------------------------------------------------------------------------------------------------------
// Public, no key. Only active products of the named store, and only fields a shopper may see.

export const storePublicRoutes = new Hono<AppEnv>();

async function storeBySlug(c: { var: AppEnv["Variables"] }, slug: string) {
  const [s] = await c.var.db.select().from(storeSettings).where(eq(storeSettings.slug, slug));
  return s;
}

storePublicRoutes.get("/:slug/products", async (c) => {
  const store = await storeBySlug(c, c.req.param("slug"));
  if (!store) return fail(c, 404, "not_found", "Store not found");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 24) || 24, 1), 50);
  const after = c.req.query("after");
  const base = and(eq(products.merchantId, store.merchantId), eq(products.status, "active"));
  const rows = await c.var.db.select().from(products).where(after ? and(base, gt(products.handle, after)) : base).orderBy(asc(products.handle)).limit(limit);
  const full = await withChildren(c.var.db, store.merchantId, rows);
  return c.json({ store: { slug: store.slug, name: store.name }, data: full.map(publicProduct), next: rows.length === limit ? rows.at(-1)!.handle : null });
});

storePublicRoutes.get("/:slug/products/:handle", async (c) => {
  const store = await storeBySlug(c, c.req.param("slug"));
  if (!store) return fail(c, 404, "not_found", "Store not found");
  const [row] = await c.var.db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, store.merchantId), eq(products.handle, c.req.param("handle")), eq(products.status, "active")));
  if (!row) return fail(c, 404, "not_found", "Product not found");
  const [full] = await withChildren(c.var.db, store.merchantId, [row]);
  return c.json({ store: { slug: store.slug, name: store.name }, product: publicProduct(full!) });
});
