"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { put } from "../../../lib/catalog";
import { NAME_MAX, NOTE_MAX, sameStore, storeBody, storeErrorText, storePath, storeProblems, suggestSlug, type StoreForm } from "../../../lib/storeSettings";

const field = "mt-1 block min-h-11 w-full rounded border border-line bg-surface px-3 py-2 text-sm";
const empty: StoreForm = { name: "", slug: "", displayNote: "" };

/** What a shopper sees at the top and bottom of the public store, drawn from the same three values. */
export function StorePreview({ form }: { form: StoreForm }) {
  return (
    <div className="rounded-2xl border border-line p-4" data-testid="store-preview" aria-label="Preview of your store">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <span className="min-w-0 truncate text-lg font-semibold">{form.name.trim() || "Your store name"}</span>
        <span className="shrink-0 rounded border border-line px-3 py-1 text-sm">Cart (0)</span>
      </div>
      <p className="mt-3 text-sm text-muted">Your products appear here.</p>
      <p className="mt-6 border-t border-line pt-3 text-xs text-muted">Payments by Stenmont. Prices are in USDT.{form.displayNote.trim() ? ` ${form.displayNote.trim()}` : ""}</p>
    </div>
  );
}

export function StoreSettings() {
  const [saved, setSaved] = useState<StoreForm | null>(null);
  const [form, setForm] = useState<StoreForm>(empty);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    api.get<{ slug: string; name: string; displayNote: string | null }>("/v1/store").then(
      (s) => { const f = { name: s.name, slug: s.slug, displayNote: s.displayNote ?? "" }; setSaved(f); setForm(f); setSlugTouched(true); setState("ready"); },
      (e: unknown) => setState(e instanceof AuthError && e.code === "not_found" ? "ready" : "error"),
    );
  }, []);

  const problems = storeProblems(form);
  const blocked = Object.keys(problems).length > 0;
  const dirty = !saved || !sameStore(form, saved);

  async function save() {
    if (busy || blocked) return;
    setBusy(true);
    setMessage(null);
    try {
      await put("/v1/store", storeBody(form));
      const f = { ...form, name: form.name.trim(), displayNote: form.displayNote.trim() };
      setSaved(f);
      setForm(f);
      setMessage({ ok: true, text: "Store saved." });
    } catch (e) {
      setMessage({ ok: false, text: storeErrorText(e instanceof AuthError ? e.code : undefined, e instanceof Error ? e.message : "") });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Card title="Your store"><p role="status" aria-busy="true" className="text-muted">Loading your store…</p></Card>;
  if (state === "error") return <Card title="Your store"><p role="alert" className="text-danger">Your store settings could not be loaded. Refresh to try again.</p></Card>;

  return (
    <Card title="Your store">
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4">
          {!saved && <p className="text-sm text-muted">You have no store yet. Name it and choose an address to open it to customers.</p>}
          <label className="text-sm font-medium" htmlFor="store-name">Store name
            <input id="store-name" className={field} value={form.name} maxLength={NAME_MAX} required onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: slugTouched ? f.slug : suggestSlug(e.target.value) }))} aria-invalid={!!problems.name && form.name !== ""} aria-describedby={problems.name ? "store-name-error" : undefined} />
          </label>
          {problems.name && form.name !== "" && <p id="store-name-error" role="alert" className="-mt-2 text-sm text-danger">{problems.name}</p>}
          <label className="text-sm font-medium" htmlFor="store-slug">Store address
            <input id="store-slug" className={field} value={form.slug} required autoCapitalize="none" spellCheck={false} placeholder="my-shop" onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() })); }} aria-invalid={!!problems.slug && form.slug !== ""} aria-describedby="store-slug-help" />
          </label>
          <p id="store-slug-help" className={`-mt-2 text-sm ${problems.slug && form.slug !== "" ? "text-danger" : "text-muted"}`} role={problems.slug && form.slug !== "" ? "alert" : undefined}>
            {problems.slug && form.slug !== "" ? problems.slug : `Customers visit …${storePath(form.slug || "my-shop")}`}
          </p>
          <label className="text-sm font-medium" htmlFor="store-note">Note for customers (optional)
            <textarea id="store-note" className={`${field} min-h-20`} rows={2} maxLength={NOTE_MAX + 50} value={form.displayNote} onChange={(e) => setForm((f) => ({ ...f, displayNote: e.target.value.replace(/[\r\n]+/g, " ") }))} aria-invalid={!!problems.displayNote} aria-describedby="store-note-help" />
          </label>
          <p id="store-note-help" className={`-mt-2 text-xs ${problems.displayNote ? "text-danger" : "text-muted"}`} role={problems.displayNote ? "alert" : undefined}>
            {problems.displayNote ?? `Shown at the bottom of your store, for example your returns or delivery info. ${form.displayNote.trim().length} of ${NOTE_MAX}.`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || blocked || !dirty} className="min-h-11 rounded border border-foreground bg-foreground px-5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">{busy ? "Saving…" : "Save store"}</button>
            {saved && <Link href={storePath(saved.slug)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline" data-testid="view-store">View store (opens in a new tab)</Link>}
          </div>
          <div aria-live="polite">{message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-danger"}`}>{message.text}</p>}</div>
        </form>
        <div>
          <h3 className="mb-2 text-sm font-medium">Preview</h3>
          <StorePreview form={form} />
        </div>
      </div>
    </Card>
  );
}
