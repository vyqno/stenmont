import { isEmail, normalHandle, parseMoney, safeText } from "./clean";
import { emptySource, ImportError, type NormCollection, type NormProduct, type Source } from "./types";

/** Strict on purpose: this string becomes the host we call, so nothing but `name.myshopify.com` may pass (no ports, paths, userinfo, IPs, subdomains). */
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const isShopDomain = (s: string) => typeof s === "string" && s.length <= 100 && SHOP.test(s);
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** Read-only scopes this import needs: read_products, read_inventory, read_customers (optional), read_orders (optional). */
export const API_VERSION = "2026-07"; // ponytail: unverified against a live shop; bump to the newest stable version if Shopify has retired it.
const TIMEOUT_MS = 20_000;
const MAX_THROTTLE_RETRIES = 5;

const Q_SHOP = `query Shop { shop { currencyCode } }`;
// Page sizes keep the requested query cost under Shopify's 1,000-point ceiling.
const Q_PRODUCTS = `query Products($after: String) { products(first: 10, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle title descriptionHtml vendor productType tags status variants(first: 30) { pageInfo { hasNextPage } nodes { sku title price selectedOptions { name value } inventoryQuantity inventoryItem { tracked } } } media(first: 8) { nodes { ... on MediaImage { image { url altText } } } } collections(first: 5) { nodes { handle title } } } } }`;
const Q_CUSTOMERS = `query Customers($after: String) { customers(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { email firstName lastName defaultAddress { countryCodeV2 } emailMarketingConsent { marketingState } } } }`;
const Q_ORDERS = `query Orders($after: String) { orders(first: 25, after: $after, sortKey: CREATED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes { name email displayFinancialStatus displayFulfillmentStatus createdAt totalPriceSet { shopMoney { amount currencyCode } } lineItems(first: 20) { nodes { id } } } } }`;

type Throttle = { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
type Gql = { data?: any; errors?: { message?: string; extensions?: { code?: string } }[]; extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: Throttle } } };

export type FetchOptions = {
  shop: string;
  token: string;
  fetch: typeof fetch;
  include?: { customers?: boolean; orders?: boolean };
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
};

/**
 * Reads a store through Shopify's Admin GraphQL API with a read-only token. The token goes into one request header and nowhere
 * else: it is not logged, not stored and not in any error message (upstream error text is never copied into ours).
 * Shopify meters queries by cost with a bucket that refills at `restoreRate` a second; before each request we wait until the bucket
 * can pay for the last query's cost, and when Shopify still says THROTTLED we wait for the shortfall and retry.
 * ponytail: the bucket state lives for one import. A shared (per-shop) limiter would matter only if two imports of one shop run at once.
 */
export async function fetchShopify(o: FetchOptions): Promise<Source> {
  if (!isShopDomain(o.shop)) throw new ImportError("bad_shop", "Enter the shop address as name.myshopify.com.");
  if (!TOKEN.test(o.token)) throw new ImportError("bad_token", "That does not look like an Admin API access token.");
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRequests = o.maxRequests ?? 300;
  const url = `https://${o.shop}/admin/api/${API_VERSION}/graphql.json`;
  let requests = 0;
  let available: number | null = null;
  let rate = 50;
  let need = 1;
  const source = emptySource();
  const w = source.warnings;
  let truncated = false;

  async function wait(ms: number) {
    if (ms > 0) await sleep(Math.min(ms, 60_000));
  }

  async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Gql | null> {
    for (let attempt = 0; ; attempt++) {
      if (requests >= maxRequests) {
        truncated = true;
        return null;
      }
      if (available !== null && available < need) await wait(Math.ceil(((need - available) / rate) * 1000));
      requests++;
      let res: Response;
      try {
        res = await o.fetch(url, {
          method: "POST",
          redirect: "manual",
          headers: { "content-type": "application/json", accept: "application/json", "X-Shopify-Access-Token": o.token },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new ImportError("shopify_unreachable", "Could not reach Shopify. Try again in a moment.", 502);
      }
      if (res.status >= 300 && res.status < 400) throw new ImportError("shopify_redirect", "Shopify answered with a redirect, which we do not follow. Check the shop address.", 422);
      if (res.status === 401 || res.status === 403) throw new ImportError("shopify_denied", "Shopify refused the token. Check that it is the Admin API access token of this shop and has the read scopes.", 422);
      if (res.status === 404) throw new ImportError("shopify_not_found", "Shopify has no shop at that address.", 422);
      if (res.status === 429) {
        if (attempt >= MAX_THROTTLE_RETRIES) throw new ImportError("shopify_throttled", "Shopify is rate limiting us. Try again in a few minutes.", 502);
        await wait((Number(res.headers.get("retry-after")) || 2) * 1000);
        continue;
      }
      if (!res.ok) throw new ImportError("shopify_error", "Shopify returned an error. Try again later.", 502);
      let body: Gql;
      try {
        body = (await res.json()) as Gql;
      } catch {
        throw new ImportError("shopify_bad_response", "Shopify sent an answer we could not read.", 502);
      }
      const c = body.extensions?.cost;
      if (c?.throttleStatus) {
        available = c.throttleStatus.currentlyAvailable;
        rate = c.throttleStatus.restoreRate || rate;
      }
      if (c?.requestedQueryCost) need = c.requestedQueryCost;
      const errors = body.errors ?? [];
      if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
        if (attempt >= MAX_THROTTLE_RETRIES) throw new ImportError("shopify_throttled", "Shopify is rate limiting us. Try again in a few minutes.", 502);
        await wait(Math.ceil((Math.max(need - (available ?? 0), 1) / rate) * 1000));
        available = need; // we have waited for the bucket to refill that far
        continue;
      }
      if (errors.length) {
        const scope = errors.map((e) => /access denied|required access/i.test(e.message ?? "") ? /read_[a-z_]+/.exec(e.message ?? "")?.[0] : undefined).find(Boolean);
        if (scope) throw new ImportError("missing_scope", `The token is missing the ${scope} permission. Add it to the app in Shopify and try again.`, 422);
        throw new ImportError("shopify_error", "Shopify could not run the query.", 502);
      }
      return body;
    }
  }

  async function pages<T>(query: string, field: string, each: (node: T) => void) {
    let after: string | null = null;
    for (;;) {
      const body = await gql(query, { after });
      if (!body) return;
      const conn = body.data?.[field];
      for (const n of (conn?.nodes ?? []) as T[]) each(n);
      if (!conn?.pageInfo?.hasNextPage) return;
      after = conn.pageInfo.endCursor as string;
    }
  }

  const shop = await gql(Q_SHOP);
  const code = shop?.data?.shop?.currencyCode;
  source.currency = typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : null;

  const collections = new Map<string, NormCollection>();
  const seen = new Set<string>();
  await pages<any>(Q_PRODUCTS, "products", (n) => {
    const handle = normalHandle(String(n.handle ?? ""));
    if (!handle || seen.has(handle)) return;
    seen.add(handle);
    if (n.variants?.pageInfo?.hasNextPage) w.add("variants_truncated", "Some products have more than 30 variants; only the first 30 were read. Use the CSV export for those.");
    const variants: NormProduct["variants"] = [];
    for (const v of n.variants?.nodes ?? []) {
      const price = parseMoney(String(v.price ?? ""));
      if (price === null || Number(price) <= 0) {
        w.add("bad_price", "Some variants had a missing, zero or unreadable price and were left out.");
        continue;
      }
      const options: Record<string, string> = {};
      for (const so of v.selectedOptions ?? []) {
        if (so.name === "Title" && so.value === "Default Title") continue;
        options[safeText(so.name, w, 40)] = safeText(so.value, w, 80);
      }
      const sku = safeText(v.sku ?? "", w, 80);
      const key = `${handle}:${sku || Object.values(options).join("/") || "default"}`;
      if (variants.some((x) => x.key === key)) {
        w.add("duplicate_variant", "Some variants repeated an earlier SKU or option set and were skipped.");
        continue;
      }
      const tracked = v.inventoryItem?.tracked === true;
      variants.push({ key, sku, title: Object.values(options).join(" / "), options, price, inventory: tracked ? Math.max(0, Number(v.inventoryQuantity) || 0) : 0, tracked });
    }
    if (variants.length === 0) {
      w.add("product_skipped", "Some items had no usable variant and were skipped.");
      return;
    }
    const cols: string[] = [];
    for (const c of n.collections?.nodes ?? []) {
      const h = normalHandle(String(c.handle ?? ""));
      if (!h) continue;
      collections.set(h, { handle: h, title: safeText(c.title, w, 120) || h });
      cols.push(h);
    }
    const type = String(n.productType ?? "");
    if (/gift card/i.test(type)) w.add("gift_card", "Gift cards are not migrated: Stenmont has no gift-card product. They are imported as normal items.");
    const tags = (n.tags ?? []).map((t: string) => safeText(t, w, 60)).filter(Boolean);
    if (tags.some((t: string) => /subscri/i.test(t))) w.add("subscription_tag", "Some items are tagged as subscriptions. Subscription plans from Shopify apps are not migrated; create them under Subscriptions.");
    const images = (n.media?.nodes ?? [])
      .filter((m: any) => m?.image?.url)
      .map((m: any, i: number) => ({ url: String(m.image.url), alt: safeText(m.image.altText ?? "", w, 200), position: i + 1 }));
    source.products.push({
      handle,
      title: safeText(n.title, w, 200),
      descriptionHtml: String(n.descriptionHtml ?? ""),
      vendor: safeText(n.vendor, w, 120),
      productType: safeText(type, w, 120),
      tags,
      status: String(n.status ?? "").toLowerCase() === "archived" ? "archived" : String(n.status ?? "").toLowerCase() === "draft" ? "draft" : "active",
      images,
      variants,
      collections: cols,
    });
  });
  source.collections = [...collections.values()];

  if (o.include?.customers) {
    const seenEmail = new Set<string>();
    await pages<any>(Q_CUSTOMERS, "customers", (n) => {
      const email = String(n.email ?? "").trim().toLowerCase();
      if (!isEmail(email) || seenEmail.has(email)) return void (isEmail(email) || w.add("bad_email", "Some customers had no valid email and were skipped."));
      seenEmail.add(email);
      source.customers.push({
        email,
        firstName: safeText(n.firstName, w, 80),
        lastName: safeText(n.lastName, w, 80),
        country: String(n.defaultAddress?.countryCodeV2 ?? "").toUpperCase().slice(0, 2),
        acceptsMarketing: n.emailMarketingConsent?.marketingState === "SUBSCRIBED",
      });
    });
  }
  if (o.include?.orders) {
    w.add("orders_window", "Shopify may return only the last 60 days of orders to this token. For older history, import the orders CSV export.");
    await pages<any>(Q_ORDERS, "orders", (n) => {
      const total = parseMoney(String(n.totalPriceSet?.shopMoney?.amount ?? ""));
      if (total === null) return void w.add("bad_order", "Some orders had an unreadable total and were skipped.");
      const email = String(n.email ?? "").trim().toLowerCase();
      source.orders.push({
        name: safeText(n.name, w, 40),
        email: isEmail(email) ? email : "",
        financialStatus: String(n.displayFinancialStatus ?? "").toLowerCase(),
        fulfillmentStatus: String(n.displayFulfillmentStatus ?? "").toLowerCase(),
        currency: String(n.totalPriceSet?.shopMoney?.currencyCode ?? "").toUpperCase().slice(0, 3),
        total,
        orderedAt: Number.isNaN(Date.parse(n.createdAt)) ? null : new Date(n.createdAt).toISOString(),
        lineCount: (n.lineItems?.nodes ?? []).length,
      });
    });
  }
  if (truncated) w.add("truncated", "Shopify's rate limit or our request cap stopped the import early, so this is only part of the store. Use the CSV export for a complete copy.");
  return source;
}
