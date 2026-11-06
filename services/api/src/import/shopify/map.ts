import { MAX_PRICE_UNITS } from "../../catalog/schemas";
import { ImportError, Warnings, type NormCollection, type NormCustomer, type NormOrder, type NormProduct, type Source, type Warning } from "./types";

const RATE_SCALE = 10n ** 8n;

export type MappedVariant = Omit<NormProduct["variants"][number], "price"> & { price: string; sourcePrice: string }; // price: USDT base units
export type MappedProduct = Omit<NormProduct, "variants"> & { variants: MappedVariant[] };
export type Mapped = {
  currency: string;
  rate: string;
  products: MappedProduct[];
  collections: NormCollection[];
  customers: NormCustomer[];
  orders: NormOrder[];
  warnings: Warnings;
};

/** Things a Shopify store has that this import never carries over. Said plainly in every report. */
export const UNSUPPORTED = [
  "Themes, pages, blog posts and navigation menus",
  "Discount codes and automatic discounts",
  "Gift cards and store credit balances",
  "Subscription plans from Shopify apps (create them under Subscriptions)",
  "Payment, shipping, tax and checkout settings",
  "Apps, metafields and custom data",
  "Customer passwords (Shopify never exports them; customers pay with a link and need no account)",
];

const toMicro = (decimal: string): bigint => {
  const [w = "0", f = ""] = decimal.split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};

/**
 * Prices become USDT only through an explicit rate the merchant gives (USDT per one unit of the store's currency).
 * Dollars need none (1 USD is taken as 1 USDT, the merchant can still override); any other currency without a rate is refused, never guessed.
 */
export function mapSource(src: Source, input: { currency?: string | undefined; rate?: string | undefined }): Mapped {
  const currency = (src.currency ?? input.currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ImportError("needs_currency", "Tell us the currency your Shopify prices are in (for example USD or EUR).", 422);
  let rate = input.rate;
  if (rate === undefined) {
    if (currency !== "USD") throw new ImportError("needs_rate", `Your prices are in ${currency}. Enter how many USDT one ${currency} is worth. We never guess a rate.`, 422);
    rate = "1";
  }
  if (!/^\d+(\.\d{1,8})?$/.test(rate)) throw new ImportError("bad_rate", "The rate must be a plain number with at most 8 decimals.", 422);
  const [rw = "0", rf = ""] = rate.split(".");
  const rate8 = BigInt(rw) * RATE_SCALE + BigInt(rf.padEnd(8, "0"));
  if (rate8 <= 0n || rate8 > 1_000_000n * RATE_SCALE) throw new ImportError("bad_rate", "The rate must be greater than zero.", 422);

  const w = src.warnings;
  const products: MappedProduct[] = [];
  for (const p of src.products) {
    const variants: MappedVariant[] = [];
    for (const v of p.variants) {
      const units = (toMicro(v.price) * rate8 + RATE_SCALE / 2n) / RATE_SCALE; // round half up
      if (units <= 0n || units > MAX_PRICE_UNITS) {
        w.add("price_out_of_range", "Some prices were zero or too large after conversion and were left out.");
        continue;
      }
      variants.push({ ...v, price: units.toString(), sourcePrice: v.price });
    }
    if (variants.length === 0) {
      w.add("product_skipped", "Some items had no usable variant and were skipped.");
      continue;
    }
    products.push({ ...p, variants });
  }
  return { currency, rate, products, collections: src.collections, customers: src.customers, orders: src.orders, warnings: w };
}

export type Report = {
  source: "csv" | "api";
  currency: string;
  rate: string;
  counts: { products: number; variants: number; images: number; collections: number; customers: number; orders: number };
  plan: { productsToCreate: number; productsToUpdate: number; productsSkipped: number };
  includeCustomers: boolean;
  warnings: Warning[];
  unsupported: string[];
};
