"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShopFrame, notifyCart } from "../../../../components/store/ShopFrame";
import { fetchProduct } from "../../../../lib/shopApi";
import { addToCart, formatPrice, htmlToText, loadCart, saveCart, stockLabel, type ShopInfo, type ShopProduct } from "../../../../lib/storefront";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; shop: ShopInfo; product: ShopProduct };

export default function ProductClient({ slug, handle }: { slug: string; handle: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchProduct(location.hostname, slug, handle)
      .then((r) => {
        if (!alive) return;
        if (!r) return setState({ kind: "missing" });
        setState({ kind: "ready", ...r });
        setVariantId((r.product.variants.find((v) => v.available) ?? r.product.variants[0])?.id ?? "");
      })
      .catch(() => alive && setState({ kind: "missing" }));
    return () => {
      alive = false;
    };
  }, [slug, handle]);

  const product = state.kind === "ready" ? state.product : null;
  const variant = product?.variants.find((v) => v.id === variantId);
  const add = () => {
    if (!variant?.available) return;
    saveCart(sessionStorage, slug, addToCart(loadCart(sessionStorage, slug), variant.id, quantity));
    notifyCart();
    setAdded(true);
  };

  return (
    <ShopFrame slug={slug} shop={state.kind === "ready" ? state.shop : null}>
      {state.kind === "loading" && <p role="status">Loading…</p>}
      {state.kind === "missing" && (
        <div data-testid="product-missing">
          <h1 className="text-2xl font-semibold">We couldn&apos;t find this product</h1>
          <Link href={`/store/${slug}`} className="underline">Back to the shop</Link>
        </div>
      )}
      {state.kind === "ready" && product && (
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-2">
            {product.images.length === 0 && <div className="aspect-square rounded bg-surface" />}
            {product.images.map((i) => (
              // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied https image; no loader for arbitrary hosts
              <img key={i.url} src={i.url} alt={i.alt || product.title} loading="lazy" referrerPolicy="no-referrer" className="w-full rounded" />
            ))}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="product-title">{product.title}</h1>
            {product.vendor && <p className="text-sm text-muted">{product.vendor}</p>}
            <p className="mt-4 text-2xl" data-testid="price">{variant ? formatPrice(variant.price) : ""}</p>
            {state.shop.displayNote && <p className="text-sm text-muted" data-testid="display-note">{state.shop.displayNote}</p>}
            {product.variants.length > 1 && (
              <label className="mt-4 block text-sm">
                Option
                <select value={variantId} onChange={(e) => { setVariantId(e.target.value); setAdded(false); }} className="mt-1 block w-full rounded border border-line bg-background p-2" data-testid="variant-select">
                  {product.variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={!v.available}>
                      {v.title || "Standard"} · {formatPrice(v.price)}{v.available ? "" : " · Sold out"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className={`mt-3 text-sm ${variant?.available ? "text-muted" : "text-danger"}`} data-testid="stock">{variant ? stockLabel(variant.available) : ""}</p>
            <div className="mt-4 flex items-end gap-3">
              <label className="text-sm">
                Quantity
                <input type="number" min={1} max={99} value={quantity} onChange={(e) => { setQuantity(Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1))); setAdded(false); }} className="mt-1 block w-20 rounded border border-line bg-background p-2" data-testid="quantity" />
              </label>
              <button type="button" onClick={add} disabled={!variant?.available} className="rounded-lg bg-brand px-6 py-2.5 font-medium text-on-brand disabled:opacity-40" data-testid="add-to-cart">
                Add to cart
              </button>
            </div>
            {added && (
              <p role="status" className="mt-3 text-sm" data-testid="added">
                Added to your cart. <Link href={`/store/${slug}/cart`} className="underline">Go to cart</Link>
              </p>
            )}
            {product.descriptionHtml && <p className="mt-6 whitespace-pre-line text-muted" data-testid="description">{htmlToText(product.descriptionHtml)}</p>}
          </div>
        </div>
      )}
    </ShopFrame>
  );
}
