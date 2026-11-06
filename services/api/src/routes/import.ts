import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { plan, write } from "../import/shopify/commit";
import { readCustomersCsv, readOrdersCsv, readProductsCsv } from "../import/shopify/csvSources";
import { fetchShopify } from "../import/shopify/graphql";
import { mapSource } from "../import/shopify/map";
import { emptySource, ImportError, type Source } from "../import/shopify/types";
import { fail } from "../errors";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";

const file = z.string().max(25_000_000);
const common = {
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  rate: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  /** Customers and orders hold personal data, so they are read only when this is explicitly true. */
  includeCustomers: z.boolean().default(false),
};
const csvBody = z.strictObject({ source: z.literal("csv"), files: z.strictObject({ products: file.optional(), customers: file.optional(), orders: file.optional() }), ...common });
const apiBody = z.strictObject({ source: z.literal("api"), shop: z.string().max(100), token: z.string().max(200), ...common });
const previewBody = z.discriminatedUnion("source", [csvBody, apiBody]);
const commitBody = z.discriminatedUnion("source", [csvBody.extend({ confirm: z.boolean().optional() }), apiBody.extend({ confirm: z.boolean().optional() })]);

export const importRoutes = new Hono<AppEnv>();

async function load(c: Context<AppEnv>, b: z.infer<typeof previewBody>): Promise<Source> {
  if (b.source === "api") return fetchShopify({ shop: b.shop, token: b.token, fetch: c.var.fetch, include: b.includeCustomers ? { customers: true, orders: true } : {} });
  const src = emptySource();
  if (!b.files.products && !(b.includeCustomers && (b.files.customers || b.files.orders))) throw new ImportError("no_files", "Choose at least the products file.");
  if (b.files.products) src.products = readProductsCsv(b.files.products, src.warnings);
  if (b.includeCustomers) {
    if (b.files.customers) src.customers = readCustomersCsv(b.files.customers, src.warnings);
    if (b.files.orders) src.orders = readOrdersCsv(b.files.orders, src.warnings);
  } else if (b.files.customers || b.files.orders) {
    src.warnings.add("customers_not_included", "Customer and order files were not read because \"include customers\" is off.");
  }
  return src;
}

/** Shared by preview and commit; nothing is written here unless `commit` is set. The Shopify token is used for this one request and goes no further. */
async function run(c: Context<AppEnv>, b: z.infer<typeof previewBody>, commit: boolean) {
  const { db, merchantId } = c.var;
  try {
    const src = await load(c, b);
    const mapped = mapSource(src, { currency: b.currency, rate: b.rate });
    const planned = await plan(db, merchantId, mapped, b.source, b.includeCustomers);
    if (!commit) return c.json({ report: planned.report });
    const statements = await write(db, merchantId, mapped, planned, b.includeCustomers, c.var.now());
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "import.shopify.committed", payload: { source: b.source, counts: planned.report.counts, plan: planned.report.plan, statements } });
    return c.json({ report: planned.report, result: { created: planned.report.plan.productsToCreate, updated: planned.report.plan.productsToUpdate, skipped: planned.report.plan.productsSkipped } });
  } catch (e) {
    if (e instanceof ImportError) return fail(c, e.status, e.code, e.message);
    throw e;
  }
}

async function guard(c: Context<AppEnv>) {
  if (Number(c.req.header("content-length") ?? 0) > 60_000_000) return fail(c, 413, "too_large", "That upload is too large. Split the files.");
  if (!(await hitRateLimit(c.var.db, `import:${c.var.merchantId}`, 20, 3600, c.var.now()))) return fail(c, 429, "rate_limited", "Too many imports. Try again later.");
  return null;
}

importRoutes.post("/shopify/preview", async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const parsed = previewBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  return run(c, parsed.data, false);
});

importRoutes.post("/shopify/commit", async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const parsed = commitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (parsed.data.confirm !== true) return fail(c, 400, "confirm_required", "Preview first, then send the same request with confirm: true.");
  return run(c, parsed.data, true);
});
