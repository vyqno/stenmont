import { fromUnits, toUnits } from "@stenmont/shared";

/** What the shop's public API returns for a product (see GET /store/:slug/products). Only the public `available` flag, never a stock count. */
export type ShopVariant = { id: string; title: string; price: string; available: boolean; options: Record<string, string> };
export type ShopProduct = {
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  images: { url: string; alt: string; position: number }[];
  variants: ShopVariant[];
};
export type ShopInfo = { slug: string; name: string; displayNote?: string };

/** The cart is ids and quantities and nothing else: no prices (the server prices the order), no personal details. */
export type Cart = { variantId: string; quantity: number }[];
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const MAX_LINES = 50;
export const MAX_QUANTITY = 99;
const clamp = (q: number) => Math.min(Math.max(Math.trunc(q), 0), MAX_QUANTITY);
const keyFor = (slug: string) => `stenmont.cart.v1.${slug}`;

export function addToCart(cart: Cart, variantId: string, quantity: number): Cart {
  const add = clamp(quantity);
  if (add < 1) return cart;
  const have = cart.find((l) => l.variantId === variantId);
  if (have) return cart.map((l) => (l === have ? { variantId, quantity: clamp(l.quantity + add) } : l));
  return cart.length >= MAX_LINES ? cart : [...cart, { variantId, quantity: add }];
}
export const setQuantity = (cart: Cart, variantId: string, quantity: number): Cart =>
  clamp(quantity) < 1 ? removeFromCart(cart, variantId) : cart.map((l) => (l.variantId === variantId ? { variantId, quantity: clamp(quantity) } : l));
export const removeFromCart = (cart: Cart, variantId: string): Cart => cart.filter((l) => l.variantId !== variantId);
export const cartCount = (cart: Cart) => cart.reduce((n, l) => n + l.quantity, 0);

/** Whatever sessionStorage holds may be old, edited or from another version: keep only well-formed lines and drop everything else (including any price). */
export function parseCart(raw: string | null): Cart {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    const out: Cart = [];
    for (const l of v) {
      const line = l as { variantId?: unknown; quantity?: unknown };
      if (typeof line?.variantId === "string" && line.variantId.length > 0 && line.variantId.length <= 80 && typeof line.quantity === "number" && clamp(line.quantity) >= 1 && out.length < MAX_LINES) {
        out.push({ variantId: line.variantId, quantity: clamp(line.quantity) });
      }
    }
    return out;
  } catch {
    return [];
  }
}
export function loadCart(store: Store, slug: string): Cart {
  try {
    return parseCart(store.getItem(keyFor(slug)));
  } catch {
    return [];
  }
}
export function saveCart(store: Store, slug: string, cart: Cart) {
  try {
    if (cart.length === 0) store.removeItem(keyFor(slug));
    else store.setItem(keyFor(slug), JSON.stringify(cart));
  } catch {
    /* blocked storage: the cart just will not be remembered */
  }
}

/** The body sent to POST /store/:slug/checkout. */
export function checkoutBody(cart: Cart, email: string) {
  const customerEmail = email.trim();
  return { items: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), ...(customerEmail ? { customerEmail } : {}) };
}

export function formatPrice(decimal: string): string {
  const [whole, frac = ""] = decimal.split(".");
  return `${whole}.${frac.padEnd(2, "0")} USDT`;
}
export function cartTotal(cart: Cart, products: Pick<ShopProduct, "variants">[]): string {
  const byId = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, v] as const)));
  return fromUnits(cart.reduce((sum, l) => sum + (byId.has(l.variantId) ? toUnits(byId.get(l.variantId)!.price) * BigInt(l.quantity) : 0n), 0n));
}
export const variantName = (p: Pick<ShopProduct, "title">, v: Pick<ShopVariant, "title">) => [p.title, v.title].filter((x) => x && x !== "Default Title").join(" - ");
export const stockLabel = (available: boolean) => (available ? "In stock" : "Sold out");

const MESSAGES: Record<string, string> = {
  variant_unavailable: "One of the items in your cart isn't for sale any more. Please remove it and try again.",
  out_of_stock: "One of the items is out of stock. Please lower the quantity or remove it.",
  payments_paused: "This shop has paused orders for now. Please try again later.",
  rate_limited: "Too many orders right now. Please wait a minute and try again.",
  not_found: "We couldn't find this shop.",
  invalid_request: "Something in your cart doesn't look right. Please check it and try again.",
  order_too_large: "This order is too large. Please split it into smaller orders.",
  idempotency_in_progress: "Your order is already being placed. Please wait a moment.",
};
export const checkoutMessage = (code: string) => MESSAGES[code] ?? "Something went wrong. Please try again.";

/** The pay page path for a pay address we were given, or null. We always go to our own /pay page, whatever host the address names. */
export function payPath(payUrl: unknown): string | null {
  try {
    const path = new URL(String(payUrl)).pathname;
    return /^\/pay\/0x[0-9a-f]{64}$/.test(path) ? path : null;
  } catch {
    return null;
  }
}

/** Product descriptions are shown as plain text: tags and entities become text, nothing from a merchant's HTML is ever run. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n\s*/g, "\n")
    .trim();
}

/** One Idempotency-Key per distinct cart: pressing Pay twice, or a retry after a dropped connection, reuses the key and so the same order. */
export function checkoutKey(store: Store, slug: string, body: unknown): string {
  const name = `stenmont.checkout.v1.${slug}`;
  const fp = JSON.stringify(body);
  try {
    const have = JSON.parse(store.getItem(name) ?? "null") as { fp?: string; key?: string } | null;
    if (have?.fp === fp && typeof have.key === "string") return have.key;
    const key = crypto.randomUUID();
    store.setItem(name, JSON.stringify({ fp, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}
