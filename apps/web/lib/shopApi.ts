import { apiBase } from "./pay";
import type { ShopInfo, ShopProduct } from "./storefront";

/** Public, read-only calls to the shop API: no key, nothing private. */
export async function fetchProducts(hostname: string, slug: string): Promise<{ shop: ShopInfo; products: ShopProduct[] } | null> {
  const base = apiBase(hostname);
  let shop: ShopInfo | null = null;
  const products: ShopProduct[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res: Response = await fetch(`${base}/store/${encodeURIComponent(slug)}/products?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { store: ShopInfo; data: ShopProduct[]; next: string | null };
    shop = body.store;
    products.push(...body.data);
    if (!body.next) break;
    after = body.next;
  }
  return shop ? { shop, products } : null;
}

export async function fetchProduct(hostname: string, slug: string, handle: string): Promise<{ shop: ShopInfo; product: ShopProduct } | null> {
  const res = await fetch(`${apiBase(hostname)}/store/${encodeURIComponent(slug)}/products/${encodeURIComponent(handle)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { store: ShopInfo; product: ShopProduct };
  return { shop: body.store, product: body.product };
}
