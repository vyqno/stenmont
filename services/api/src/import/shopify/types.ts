/** One shape for everything we read from Shopify, whether it came from a CSV export or the Admin API. Prices are still in the store's own currency. */

export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 422 | 502 = 400,
  ) {
    super(message);
  }
}

export type Warning = { code: string; message: string; count: number };

/** Collects warnings by code so a 10,000-row problem is one line in the report, not 10,000. */
export class Warnings {
  private readonly byCode = new Map<string, Warning>();
  add(code: string, message: string, n = 1) {
    const w = this.byCode.get(code);
    if (w) w.count += n;
    else this.byCode.set(code, { code, message, count: n });
  }
  list(): Warning[] {
    return [...this.byCode.values()];
  }
}

export type NormVariant = {
  key: string; // stable across CSV and API: `${handle}:${sku or options}`
  sku: string;
  title: string;
  options: Record<string, string>;
  price: string; // decimal string, store currency
  inventory: number;
  tracked: boolean;
};
export type NormProduct = {
  handle: string;
  title: string;
  descriptionHtml: string; // raw here; sanitised when written
  vendor: string;
  productType: string;
  tags: string[];
  status: "active" | "draft" | "archived";
  images: { url: string; alt: string; position: number }[];
  variants: NormVariant[];
  collections: string[]; // handles
};
export type NormCollection = { handle: string; title: string };
/** The minimum: no phone, no street address, no notes, no spend totals, and Shopify never exports passwords. */
export type NormCustomer = { email: string; firstName: string; lastName: string; country: string; acceptsMarketing: boolean };
/** A record of an old sale, not a Stenmont payment. No addresses and no line-item detail. */
export type NormOrder = { name: string; email: string; financialStatus: string; fulfillmentStatus: string; currency: string; total: string; orderedAt: string | null; lineCount: number };

export type Source = {
  /** The store's currency when the source states it (the API does; a CSV export does not). */
  currency: string | null;
  products: NormProduct[];
  collections: NormCollection[];
  customers: NormCustomer[];
  orders: NormOrder[];
  warnings: Warnings;
};

export const emptySource = (): Source => ({ currency: null, products: [], collections: [], customers: [], orders: [], warnings: new Warnings() });
