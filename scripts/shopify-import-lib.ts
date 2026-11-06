// Pure parts of shopify-import-demo.ts, so they can be tested without a network or a Shopify store.

export class UsageError extends Error {}

export type Config = {
  mode: "csv" | "api";
  apiUrl: string;
  apiKey: string;
  confirm: boolean;
  includeCustomers: boolean;
  currency?: string;
  rate?: string;
  csvDir?: string;
  shop?: string;
  token?: string;
};

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Flags: --csv-dir <folder> | (env SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_TOKEN), --api-url <url>, --confirm, --include-customers,
 * --currency <ISO>, --rate <USDT per unit>. The Shopify token and the Stenmont key come from the environment only: a flag would
 * end up in shell history and the process list.
 */
export function parseConfig(argv: string[], env: Record<string, string | undefined>): Config {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new UsageError(`Unexpected argument: ${a}`);
    const name = a.slice(2);
    if (["confirm", "include-customers"].includes(name)) flags.set(name, true);
    else if (["csv-dir", "api-url", "currency", "rate"].includes(name)) {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      flags.set(name, v);
    } else throw new UsageError(`Unknown flag: --${name}`);
  }
  const str = (n: string) => (typeof flags.get(n) === "string" ? (flags.get(n) as string) : undefined);

  const apiUrl = str("api-url")?.replace(/\/+$/, "");
  if (!apiUrl) throw new UsageError("--api-url is required, for example https://api-staging.stenmont.com");
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    throw new UsageError("--api-url is not a valid address");
  }
  const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new UsageError("--api-url must be https (or http://localhost for local runs)");
  if (u.hostname === "api.stenmont.com") throw new UsageError("This demo script does not talk to production.");

  const apiKey = env.STENMONT_API_KEY;
  if (!apiKey) throw new UsageError("Set STENMONT_API_KEY (a merchant API key) in the environment");

  const csvDir = str("csv-dir");
  const shop = env.SHOPIFY_SHOP_DOMAIN?.trim().toLowerCase();
  const token = env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (csvDir && (shop || token)) throw new UsageError("Choose one: --csv-dir, or SHOPIFY_SHOP_DOMAIN with SHOPIFY_ADMIN_TOKEN. Both are set.");
  const base = { apiUrl, apiKey, confirm: flags.has("confirm"), includeCustomers: flags.has("include-customers"), ...(str("currency") ? { currency: str("currency")!.toUpperCase() } : {}), ...(str("rate") ? { rate: str("rate")! } : {}) };
  if (csvDir) return { mode: "csv", csvDir, ...base };
  if (!shop || !token) throw new UsageError("Give --csv-dir <folder>, or set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN");
  if (!SHOP.test(shop)) throw new UsageError("SHOPIFY_SHOP_DOMAIN must look like your-store.myshopify.com");
  return { mode: "api", shop, token, ...base };
}

/** Reads the three export files from a folder. Customers and orders are opened only when --include-customers was given. */
export function readCsvDir(dir: string, includeCustomers: boolean, read: (path: string) => string | null) {
  const get = (name: string) => read(`${dir.replace(/\/+$/, "")}/${name}`) ?? undefined;
  const products = get("products_export.csv");
  if (!products) throw new UsageError(`products_export.csv was not found in ${dir}`);
  if (!includeCustomers) return { products };
  const customers = get("customers_export.csv");
  const orders = get("orders_export.csv");
  if (!customers && !orders) throw new UsageError("--include-customers needs customers_export.csv or orders_export.csv in the folder");
  return { products, ...(customers ? { customers } : {}), ...(orders ? { orders } : {}) };
}

export function buildBody(cfg: Config, files: Record<string, string> | null, confirm: boolean) {
  const common = { includeCustomers: cfg.includeCustomers, ...(cfg.rate ? { rate: cfg.rate } : {}), ...(confirm ? { confirm: true } : {}) };
  if (cfg.mode === "api") return { source: "api", shop: cfg.shop, token: cfg.token, ...common };
  return { source: "csv", currency: cfg.currency ?? "USD", files, ...common };
}

/** Counts and warnings only. Built from a fixed list of fields, so nothing else the server might send is ever printed. */
export function formatReport(r: any): string[] {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const c = r?.counts ?? {};
  const p = r?.plan ?? {};
  const out = [
    `source: ${r?.source === "api" ? "Shopify Admin API" : "CSV files"}   currency: ${String(r?.currency ?? "?").slice(0, 3)}   rate to USDT: ${String(r?.rate ?? "?").slice(0, 20)}`,
    `products ${num(c.products)} (new ${num(p.productsToCreate)}, update ${num(p.productsToUpdate)}, skipped ${num(p.productsSkipped)})`,
    `variants ${num(c.variants)}   images ${num(c.images)}   collections ${num(c.collections)}`,
    r?.includeCustomers ? `customers ${num(c.customers)}   past orders ${num(c.orders)}   (records only)` : "customers and orders: not included",
  ];
  const warnings = Array.isArray(r?.warnings) ? r.warnings : [];
  out.push(warnings.length ? "warnings:" : "warnings: none");
  for (const w of warnings) out.push(`  - ${String(w?.message ?? w?.code ?? "").slice(0, 300)} (${num(w?.count)})`);
  const unsupported = Array.isArray(r?.unsupported) ? r.unsupported : [];
  if (unsupported.length) {
    out.push("not migrated:");
    for (const u of unsupported) out.push(`  - ${String(u).slice(0, 200)}`);
  }
  return out;
}

/** Replaces every secret in a string, for anything printed after an error. */
export const scrub = (text: string, secrets: (string | undefined)[]) => secrets.filter((s): s is string => !!s && s.length > 3).reduce((t, s) => t.split(s).join("***"), text);
