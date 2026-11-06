"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShopFrame, notifyCart } from "../../../../components/store/ShopFrame";
import { apiBase } from "../../../../lib/pay";
import { fetchProducts } from "../../../../lib/shopApi";
import {
  cartTotal, checkoutBody, checkoutKey, checkoutMessage, formatPrice, loadCart, payPath, removeFromCart, saveCart, setQuantity, variantName,
  type Cart, type ShopInfo, type ShopProduct,
} from "../../../../lib/storefront";

export default function CartClient({ slug }: { slug: string }) {
  const [cart, setCart] = useState<Cart>([]);
  const [data, setData] = useState<{ shop: ShopInfo; products: ShopProduct[] } | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setCart(loadCart(sessionStorage, slug));
    let alive = true;
    fetchProducts(location.hostname, slug).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  const update = (next: Cart) => {
    setCart(next);
    saveCart(sessionStorage, slug, next);
    notifyCart();
    setNotice(null);
  };

  const checkout = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const body = checkoutBody(cart, email);
      const res = await fetch(`${apiBase(location.hostname)}/store/${encodeURIComponent(slug)}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": checkoutKey(sessionStorage, slug, body) },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { payUrl?: string; error?: { code?: string } };
      const path = res.ok ? payPath(json.payUrl) : null;
      if (path) return location.assign(path);
      setNotice(checkoutMessage(res.ok ? "unknown" : (json.error?.code ?? "unknown")));
    } catch {
      setNotice(checkoutMessage("unknown"));
    }
    setBusy(false);
  }, [cart, email, slug]);

  const lookup = new Map((data?.products ?? []).flatMap((p) => p.variants.map((v) => [v.id, { p, v }] as const)));
  const known = cart.filter((l) => lookup.has(l.variantId));
  const missing = data ? cart.length - known.length : 0;

  return (
    <ShopFrame slug={slug} shop={data?.shop ?? null}>
      <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>
      {data === undefined && <p role="status">Loading…</p>}
      {data === null && <p className="text-muted">We couldn&apos;t load this shop. Please try again.</p>}
      {data && cart.length === 0 && (
        <p className="text-muted" data-testid="cart-empty">
          Your cart is empty. <Link href={`/store/${slug}`} className="underline">Keep shopping</Link>
        </p>
      )}
      {data && cart.length > 0 && (
        <>
          <ul className="divide-y divide-line" data-testid="cart-lines">
            {known.map((l) => {
              const { p, v } = lookup.get(l.variantId)!;
              return (
                <li key={l.variantId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="cart-line">
                  <div>
                    <p className="font-medium">{variantName(p, v)}</p>
                    <p className="text-sm text-muted">{formatPrice(v.price)} each{v.available ? "" : " · Sold out"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input aria-label={`Quantity for ${variantName(p, v)}`} type="number" min={1} max={99} value={l.quantity} onChange={(e) => update(setQuantity(cart, l.variantId, Number(e.target.value)))} className="w-20 rounded border border-line bg-background p-2" />
                    <button type="button" onClick={() => update(removeFromCart(cart, l.variantId))} className="text-sm underline">Remove</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {missing > 0 && (
            <p role="alert" className="mt-3 rounded border border-danger p-3 text-sm text-danger" data-testid="cart-stale">
              {missing === 1 ? "One item in your cart isn't for sale any more." : `${missing} items in your cart aren't for sale any more.`}{" "}
              <button type="button" className="underline" onClick={() => update(known)}>Remove {missing === 1 ? "it" : "them"}</button>
            </p>
          )}
          <div className="mt-6 space-y-4">
            <p className="text-xl" data-testid="cart-total">Total {formatPrice(cartTotal(known, data.products))}</p>
            <p className="text-xs text-muted">The shop confirms the final price when you check out.</p>
            <label className="block text-sm">
              Email for your receipt (optional)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 block w-full max-w-sm rounded border border-line bg-background p-2" data-testid="email" />
            </label>
            {notice && <p role="alert" className="rounded border border-danger p-3 text-sm text-danger" data-testid="notice">{notice}</p>}
            <button type="button" onClick={checkout} disabled={busy || missing > 0} className="rounded-lg bg-brand px-6 py-3 text-lg font-medium text-white disabled:opacity-40" data-testid="checkout">
              {busy ? "Placing your order…" : "Check out"}
            </button>
          </div>
        </>
      )}
    </ShopFrame>
  );
}
