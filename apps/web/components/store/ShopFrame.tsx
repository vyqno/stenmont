"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { cartCount, loadCart, type ShopInfo } from "../../lib/storefront";

/** Header and cart link shared by the shop pages. The cart lives in this browser tab (session storage) and holds ids and quantities only. */
export function ShopFrame({ slug, shop, children }: { slug: string; shop: ShopInfo | null; children: ReactNode }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => setCount(cartCount(loadCart(sessionStorage, slug)));
    read();
    addEventListener("stenmont-cart", read);
    return () => removeEventListener("stenmont-cart", read);
  }, [slug]);
  return (
    <div className="customer-store" data-testid="shop">
      <header className="mb-8 flex items-center justify-between border-b border-line pb-4">
        <Link href={`/store/${slug}`} className="text-xl font-semibold tracking-tight" data-testid="shop-name">
          {shop?.name ?? "Shop"}
        </Link>
        <Link href={`/store/${slug}/cart`} className="rounded border border-line px-3 py-1.5 text-sm hover:border-brand" data-testid="cart-link">
          Cart ({count})
        </Link>
      </header>
      {children}
      <footer className="mt-12 border-t border-line pt-4 text-xs text-muted">Payments by Stenmont. Prices are in USDT.{shop?.displayNote ? ` ${shop.displayNote}` : ""}</footer>
    </div>
  );
}

export const notifyCart = () => dispatchEvent(new Event("stenmont-cart"));
