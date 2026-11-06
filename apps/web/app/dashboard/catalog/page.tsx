"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge, Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { patch, productSummary, put } from "../../../lib/catalog";
import { useApi } from "../../../lib/useApi";

type Variant = { id: string; title: string; sku: string; price: string; inventory: number; trackInventory: boolean };
type Product = { id: string; handle: string; title: string; status: "draft" | "active" | "archived"; variants: Variant[] };

const field = "rounded border border-line bg-surface px-2 py-1 text-sm";
const button = "rounded border border-line px-3 py-1 text-sm hover:border-brand disabled:opacity-50";
const TONE = { active: "ok", draft: "wait", archived: "off" } as const;

export default function Catalog() {
  const { data, error, reload } = useApi<{ data: Product[] }>("/v1/products?limit=50");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [store, setStore] = useState({ slug: "", name: "" });
  const [open, setOpen] = useState("");

  useEffect(() => {
    api.get<{ slug: string; name: string }>("/v1/store").then(setStore, () => null);
  }, []);

  async function attempt(run: () => Promise<unknown>, ok = "Saved.") {
    setMessage("");
    try {
      await run();
      setMessage(ok);
      reload();
    } catch (e) {
      setMessage(e instanceof AuthError || e instanceof Error ? e.message : "That could not be saved.");
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault();
    return attempt(async () => {
      await api.post("/v1/products", { title, status: "active", variants: [{ price, inventory: Number(stock) }] });
      setTitle("");
      setPrice("");
    }, "Product added.");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Catalogue</h1>
        <Link href="/dashboard/import" className={button}>Import from Shopify</Link>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}

      <Card title="Store address">
        <form onSubmit={(e) => { e.preventDefault(); attempt(() => put("/v1/store", store)); }} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Name<input value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} required className={`${field} block`} /></label>
          <label className="text-sm">Address<input value={store.slug} onChange={(e) => setStore({ ...store, slug: e.target.value })} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" className={`${field} block`} placeholder="my-shop" /></label>
          <button className={button}>Save</button>
        </form>
      </Card>

      <Card title="Add a product">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Name<input value={title} onChange={(e) => setTitle(e.target.value)} required className={`${field} block`} /></label>
          <label className="text-sm">Price (USD)<input value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="decimal" pattern="\d+(\.\d{1,6})?" className={`${field} block w-28`} /></label>
          <label className="text-sm">In stock<input value={stock} onChange={(e) => setStock(e.target.value)} required type="number" min={0} className={`${field} block w-24`} /></label>
          <button className={button}>Add</button>
        </form>
      </Card>

      <Card>
        {error && <p role="status" className="text-danger">{error}</p>}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.data.length === 0 && <p className="text-muted">No products yet. Add one above, or import your Shopify store.</p>}
        {data && data.data.length > 0 && (
          <ul className="divide-y divide-line" data-testid="product-list">
            {data.data.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{p.title}</span>
                  <Badge tone={TONE[p.status]}>{p.status}</Badge>
                  <span className="text-sm text-muted">{productSummary(p.variants)}</span>
                  <span className="ml-auto" />
                  <button type="button" className={button} onClick={() => setOpen(open === p.id ? "" : p.id)}>{open === p.id ? "Close" : "Edit"}</button>
                  <button type="button" className={button} onClick={() => attempt(() => patch(`/v1/products/${p.id}`, { status: p.status === "active" ? "draft" : "active" }))}>{p.status === "active" ? "Hide" : "Publish"}</button>
                </div>
                {open === p.id && (
                  <table className="mt-3 w-full text-sm">
                    <thead><tr className="text-left text-muted"><th className="py-1">Variant</th><th>Price (USD)</th><th>In stock</th><th /></tr></thead>
                    <tbody>{p.variants.map((v) => <VariantRow key={v.id} v={v} save={(body) => attempt(() => patch(`/v1/variants/${v.id}`, body))} />)}</tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function VariantRow({ v, save }: { v: Variant; save: (body: { price: string; inventory: number }) => void }) {
  const [price, setPrice] = useState(v.price);
  const [inventory, setInventory] = useState(String(v.inventory));
  return (
    <tr>
      <td className="py-1">{v.title || v.sku || "Default"}</td>
      <td><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={`${field} w-28`} aria-label={`Price for ${v.title || "variant"}`} /></td>
      <td>{v.trackInventory ? <input value={inventory} onChange={(e) => setInventory(e.target.value)} type="number" min={0} className={`${field} w-24`} aria-label={`Stock for ${v.title || "variant"}`} /> : <span className="text-muted">always available</span>}</td>
      <td><button type="button" className={button} onClick={() => save({ price, inventory: Number(inventory) })}>Save</button></td>
    </tr>
  );
}
