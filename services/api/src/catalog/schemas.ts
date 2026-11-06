import { z } from "zod";
import { toUnits } from "@stenmont/shared";
import { isPublicHttpsUrl } from "../lib/validation";

/** Biggest single price (USDT) and biggest cart total: far below anything that could overflow a uint256, and a sanity bound for a typo. */
export const MAX_PRICE_UNITS = 10_000_000n * 1_000_000n;
export const MAX_ORDER_UNITS = 100_000_000n * 1_000_000n;
export const MAX_INVENTORY = 1_000_000;

export const handleSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, "lower-case letters, digits and dashes");
export const slugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3 to 40 lower-case letters, digits and dashes");

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "item";

/** A price in USDT as a decimal string; greater than zero and not above the cap. (zod runs refinements after a failed pattern, so never throw here.) */
export const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "must be a decimal with at most 6 places")
  .refine((v) => {
    try {
      const u = toUnits(v);
      return u > 0n && u <= MAX_PRICE_UNITS;
    } catch {
      return false;
    }
  }, "must be greater than zero and at most 10,000,000");

export const imageSchema = z.strictObject({
  url: z.string().max(2048).refine(isPublicHttpsUrl, "must be a public https address"),
  alt: z.string().max(200).optional(),
});

const text = (max: number) => z.string().max(max);
export const variantInput = z.strictObject({
  title: text(120).optional(),
  sku: text(80).optional(),
  price: priceSchema,
  inventory: z.number().int().min(0).max(MAX_INVENTORY).default(0),
  trackInventory: z.boolean().default(true),
  options: z.record(z.string().max(40), z.string().max(80)).refine((o) => Object.keys(o).length <= 3, "at most 3 options").optional(),
});
export const variantPatch = variantInput.partial();

const productFields = {
  title: z.string().min(1).max(200),
  handle: handleSchema.optional(),
  descriptionHtml: text(50_000).optional(),
  vendor: text(120).optional(),
  productType: text(120).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  tags: z.array(z.string().min(1).max(60)).max(50).optional(),
  images: z.array(imageSchema).max(20).optional(),
};
export const productInput = z.strictObject({ ...productFields, variants: z.array(variantInput).min(1).max(100) });
export const productPatch = z.strictObject({ ...productFields }).partial();

export const storeInput = z.strictObject({ slug: slugSchema, name: z.string().min(1).max(120), displayNote: z.string().max(200).optional() });
