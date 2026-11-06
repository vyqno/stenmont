# Moving a Shopify store into Stenmont

Two routes, same result: upload Shopify's CSV exports, or connect with a read-only Admin API token. Both go through
`POST /v1/import/shopify/preview` (reads and reports, writes nothing) and `POST /v1/import/shopify/commit` (needs `"confirm": true`).

## What moves

| From Shopify | Into Stenmont |
|---|---|
| Products, variants (price, SKU, options, stock), images, tags, collections | Catalogue (`/v1/products`, public `GET /store/:slug/products`) |
| Customers (only with `includeCustomers: true`) | Records: email, first and last name, country, marketing consent |
| Past orders (only with `includeCustomers: true`) | Records: number, email, status, currency, total, date, line count. No addresses, no line detail |

## What does not move

Themes and pages, discount codes, gift cards and store credit, subscription plans from apps, payment/shipping/tax settings,
apps and metafields, and customer passwords (Shopify never exports them).

## Rules

- **Dry run first.** Preview returns counts, warnings and the not-migrated list. Commit repeats the same work and writes.
- **Prices** are converted to USDT only by a rate the merchant enters (USDT per one unit of the store currency). USD needs none
  (1 USD is taken as 1 USDT). Any other currency without a rate returns `needs_rate`. Past-order totals stay in their own currency.
- **Idempotent.** Rows are keyed on business + `shopify` + external id (product handle, `handle:sku` for variants, email for
  customers, order number for orders). Re-running updates; it never duplicates, and never deletes. A re-run resets stock to the
  numbers in the new export.
- **Hand-made products are safe.** An imported product whose handle matches one the business made by hand is skipped and reported.
- **Personal data is opt-in** and minimal (see the table). The token is used for the request that carries it, never stored,
  logged or returned.
- **Shop address** must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`; redirects are not followed.
- **Descriptions** pass an allow-list HTML sanitiser (no scripts, handlers, iframes or non-http(s)/mailto links).
- **Limits:** 50,000 rows per CSV, 25 MB per file, 20,000 database writes per import, 20 imports an hour per business.
  The API route is slow on big stores because Shopify meters queries by cost; use the CSV route for large catalogues.

Command line: `pnpm --filter @stenmont/scripts shopify-import --help` is the file header of `scripts/shopify-import-demo.ts`.
