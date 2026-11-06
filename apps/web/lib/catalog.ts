import { toUnits } from "@stenmont/shared";
import { apiBase } from "./pay";

export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** "https://Demo.myshopify.com/admin/products" -> "demo.myshopify.com". Null unless it is exactly a myshopify.com shop address. */
export function normalizeShop(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  return SHOP_RE.test(v) ? v : null;
}

export const isRate = (s: string) => /^\d+(\.\d{1,8})?$/.test(s.trim()) && Number(s) > 0;

export type ImportForm = {
  source: "csv" | "api";
  currency: string;
  rate: string;
  includeCustomers: boolean;
  files: { products?: string; customers?: string; orders?: string };
  shop: string;
  token: string;
};

/** Why the form cannot be sent yet, in plain words; null when it is ready. Mirrors the server's rules so people find out before waiting. */
export function formProblem(f: ImportForm): string | null {
  const currency = f.currency.trim().toUpperCase();
  if (f.source === "csv") {
    if (!f.files.products) return "Choose your products file.";
    if (!/^[A-Z]{3}$/.test(currency)) return "Enter the currency your prices are in, for example USD or EUR.";
    if (currency !== "USD" && !isRate(f.rate)) return `Enter what one ${currency} is worth in USDT. We never guess a rate.`;
    if (f.includeCustomers && !f.files.customers && !f.files.orders) return "Choose a customers or orders file, or turn off “include customers”.";
    return null;
  }
  if (!normalizeShop(f.shop)) return "Enter your shop address, like your-store.myshopify.com.";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(f.token.trim())) return "Paste the Admin API access token from your Shopify custom app.";
  if (f.rate.trim() && !isRate(f.rate)) return "The rate must be a plain number such as 1.08.";
  return null;
}

export function buildImportRequest(f: ImportForm, confirm = false) {
  const base = { includeCustomers: f.includeCustomers, ...(f.rate.trim() ? { rate: f.rate.trim() } : {}), ...(confirm ? { confirm: true } : {}) };
  if (f.source === "api") return { source: "api" as const, shop: normalizeShop(f.shop) ?? f.shop, token: f.token.trim(), ...base };
  return { source: "csv" as const, currency: f.currency.trim().toUpperCase(), files: f.files, ...base };
}

export type Report = {
  source: "csv" | "api";
  currency: string;
  rate: string;
  counts: { products: number; variants: number; images: number; collections: number; customers: number; orders: number };
  plan: { productsToCreate: number; productsToUpdate: number; productsSkipped: number };
  includeCustomers: boolean;
  warnings: { code: string; message: string; count: number }[];
  unsupported: string[];
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The preview in sentences a shop owner can check against their own store. */
export function describeReport(r: Report): string[] {
  const lines = [
    `${n(r.plan.productsToCreate, "new product")} and ${n(r.plan.productsToUpdate, "product")} to update, with ${n(r.counts.variants, "variant")} and ${n(r.counts.images, "image")}.`,
  ];
  if (r.plan.productsSkipped) lines.push(`${n(r.plan.productsSkipped, "product")} skipped because you already have one with the same address.`);
  if (r.counts.collections) lines.push(`${n(r.counts.collections, "collection")}.`);
  if (r.includeCustomers) lines.push(`${n(r.counts.customers, "customer")} and ${n(r.counts.orders, "past order")} saved as records only (name, email, country; orders without addresses).`);
  else lines.push("Customers and past orders are not included.");
  lines.push(r.currency === "USD" && r.rate === "1" ? "Prices in USD are taken as USDT one to one." : `Prices in ${r.currency} are converted at 1 ${r.currency} = ${r.rate} USDT.`);
  return lines;
}

export function warningLine(w: { message: string; count: number }) {
  return w.count > 1 ? `${w.message} (${w.count})` : w.message;
}

const ERRORS: Record<string, string> = {
  needs_rate: "Your prices are not in dollars, so we need your rate (how many USDT one unit is worth).",
  needs_currency: "Tell us which currency your prices are in.",
  bad_shop: "That is not a Shopify shop address. Use your-store.myshopify.com.",
  shopify_denied: "Shopify refused the token. Check it belongs to this shop and has the read permissions.",
  missing_scope: "The token is missing a read permission. Add it to the app in Shopify and try again.",
  wrong_file: "That file does not look like the Shopify export we expected.",
  too_many_rows: "That file is too big. Split it into smaller files.",
  rate_limited: "Too many imports just now. Try again later.",
};
export const importMessage = (code: string, fallback: string) => ERRORS[code] ?? fallback;

type Variant = { price: string; inventory: number; trackInventory: boolean };
/** "$10 to $25 · 7 in stock" for the catalogue list. */
export function productSummary(vs: Variant[]): string {
  if (vs.length === 0) return "No variants";
  const prices = vs.map((v) => toUnits(v.price)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const fmt = (u: bigint) => `$${(Number(u) / 1e6).toFixed(2)}`;
  const range = prices[0] === prices.at(-1) ? fmt(prices[0]!) : `${fmt(prices[0]!)} to ${fmt(prices.at(-1)!)}`;
  if (vs.some((v) => !v.trackInventory)) return `${range} · always available`;
  const stock = vs.reduce((s, v) => s + v.inventory, 0);
  return `${range} · ${stock === 0 ? "sold out" : `${stock} in stock`}`;
}

/** The catalogue API needs PATCH, which the shared helper does not offer; same cookie, same error shape. */
export async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiBase(location.hostname) + path, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "That could not be saved.");
  return json as T;
}
export async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiBase(location.hostname) + path, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "That could not be saved.");
  return json as T;
}
