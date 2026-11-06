"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShopFrame, notifyCart } from "../../../components/store/ShopFrame";
import { loadAccountToken, accountUrl } from "../../../lib/account";
import { fetchProducts } from "../../../lib/shopApi";
import { formatPrice, saveCart, type ShopInfo, type ShopProduct } from "../../../lib/storefront";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; shop: ShopInfo; products: ShopProduct[] };

const fromPrice = (p: ShopProduct) => formatPrice([...p.variants].map((v) => v.price).sort((a, b) => Number(a) - Number(b))[0] ?? "0");

export default function StoreClient({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [thanks, setThanks] = useState(false);
  const [receipts, setReceipts] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProducts(location.hostname, slug)
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (new URLSearchParams(location.search).get("thanks") === "1") {
          // The shopper has paid and come back: the cart is done.
          setThanks(true);
          saveCart(sessionStorage, slug, []);
          notifyCart();
          const t = loadAccountToken(localStorage);
          if (t) setReceipts(accountUrl(location.origin, t));
        }
        setState(r ? { kind: "ready", ...r } : { kind: "missing" });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const shop = state.kind === "ready" ? state.shop : null;
  return (
    <ShopFrame slug={slug} shop={shop}>
      {state.kind === "ready" && <h1 className="mb-6 text-3xl font-semibold">Products</h1>}
      {thanks && (
        <div className="mb-6 rounded border border-line bg-surface p-4" data-testid="thanks" role="status">
          <p className="font-medium">Thank you for your order.</p>
          <p className="text-sm text-muted">The shop has your payment.{receipts && <> <Link href={receipts} className="underline">See your receipts</Link>.</>}</p>
        </div>
      )}
      {state.kind === "loading" && <p role="status">Loading…</p>}
      {state.kind === "missing" && (
        <div data-testid="shop-missing">
          <h1 className="text-2xl font-semibold">We couldn&apos;t find this shop</h1>
          <p className="text-muted">The link may be wrong, or the shop may be closed.</p>
        </div>
      )}
      {state.kind === "ready" && state.products.length === 0 && <p className="text-muted">Nothing for sale yet. Please check back soon.</p>}
      {state.kind === "ready" && state.products.length > 0 && (
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-3" data-testid="product-grid">
          {state.products.map((p) => {
            const sold = p.variants.every((v) => !v.available);
            return (
              <li key={p.handle}>
                <Link href={`/store/${slug}/${p.handle}`} className="block" data-testid="product-card">
                  <div className="grid aspect-square place-items-center overflow-hidden rounded bg-grey">
                    {!p.images[0] && <span className="px-4 text-center text-sm text-muted">No image supplied</span>}
                    {p.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied https image; no loader for arbitrary hosts
                      <img src={p.images[0].url} alt={p.images[0].alt || p.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <h2 className="mt-2 font-medium">{p.title}</h2>
                  <p className="text-sm text-muted">{sold ? "Sold out" : `${p.variants.length > 1 ? "From " : ""}${fromPrice(p)}`}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ShopFrame>
  );
}
