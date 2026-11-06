"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { buildImportRequest, describeReport, formProblem, importMessage, warningLine, type ImportForm, type Report } from "../../../lib/catalog";

const field = "mt-1 block w-full rounded border border-line bg-surface px-3 py-2 text-sm";
const button = "rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";
const ghost = "rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50";
const empty: ImportForm = { source: "csv", currency: "USD", rate: "", includeCustomers: false, files: {}, shop: "", token: "" };

type Step = "choose" | "preview" | "done";

export default function ImportWizard() {
  const [form, setForm] = useState<ImportForm>(empty);
  const [step, setStep] = useState<Step>("choose");
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<ImportForm>) => setForm((f) => ({ ...f, ...patch }));
  const problem = formProblem(form);

  async function pick(kind: "products" | "customers" | "orders", e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    set({ files: { ...form.files, [kind]: file ? await file.text() : undefined } });
  }

  async function run(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      const body = buildImportRequest(form, confirm);
      if (!confirm) {
        setReport((await api.post<{ report: Report }>("/v1/import/shopify/preview", body)).report);
        setStep("preview");
      } else {
        const out = await api.post<{ report: Report; result: { created: number; updated: number; skipped: number } }>("/v1/import/shopify/commit", body);
        setResult(out.result);
        setForm((f) => ({ ...f, token: "", files: {} })); // the token and the files are not kept once the import has run
        setStep("done");
      }
    } catch (e) {
      setError(e instanceof AuthError ? importMessage(e.code, e.message) : "The import could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Move your store from Shopify</h1>
        <p className="mt-1 text-muted">Bring your products over, and your customers and past orders if you choose. You see exactly what will happen before anything is saved.</p>
      </div>

      {step === "choose" && (
        <Card title="1. Where is your store data?">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Import method">
            {(["csv", "api"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={form.source === s} onClick={() => set({ source: s })} className={`${ghost} ${form.source === s ? "border-brand" : ""}`}>
                {s === "csv" ? "Upload Shopify export files" : "Connect with an access token"}
              </button>
            ))}
          </div>

          {form.source === "csv" ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted">In Shopify, open Products, Customers or Orders and choose Export, then pick “CSV for Excel, Numbers, or other spreadsheet programs”.</p>
              <label className="text-sm">Products file (required)<input type="file" accept=".csv,text/csv" onChange={(e) => pick("products", e)} className={field} data-testid="file-products" /></label>
              <label className="text-sm">Currency of your prices
                <input value={form.currency} onChange={(e) => set({ currency: e.target.value })} maxLength={3} className={`${field} uppercase`} placeholder="USD" />
              </label>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted">In Shopify, create a custom app with read-only access to products, inventory (and customers and orders if you want them), then paste its Admin API access token. We use it for this import only and never store it.</p>
              <label className="text-sm">Shop address<input value={form.shop} onChange={(e) => set({ shop: e.target.value })} className={field} placeholder="your-store.myshopify.com" autoComplete="off" spellCheck={false} /></label>
              <label className="text-sm">Admin API access token<input value={form.token} onChange={(e) => set({ token: e.target.value })} type="password" className={field} autoComplete="off" spellCheck={false} data-testid="token" /></label>
            </div>
          )}

          {(form.currency.trim().toUpperCase() !== "USD" || form.source === "api") && (
            <label className="mt-3 block text-sm">
              {form.source === "api" ? "Rate to USDT (needed only if your store does not sell in dollars)" : `What is one ${form.currency.trim().toUpperCase() || "unit"} worth in USDT?`}
              <input value={form.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" className={field} placeholder="for example 1.08" />
              <span className="text-xs text-muted">You enter the rate. We never look one up or guess.</span>
            </label>
          )}

          <fieldset className="mt-4 rounded border border-line p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.includeCustomers} onChange={(e) => set({ includeCustomers: e.target.checked })} className="mt-1" />
              <span>Also bring customers and past orders<br /><span className="text-muted">This is personal data. We keep only name, email, country and whether they agreed to marketing, and for orders the status, date and total. No addresses, phone numbers or notes.</span></span>
            </label>
            {form.includeCustomers && form.source === "csv" && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm">Customers file<input type="file" accept=".csv,text/csv" onChange={(e) => pick("customers", e)} className={field} /></label>
                <label className="text-sm">Orders file<input type="file" accept=".csv,text/csv" onChange={(e) => pick("orders", e)} className={field} /></label>
              </div>
            )}
          </fieldset>

          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          {problem && <p className="mt-3 text-sm text-muted">{problem}</p>}
          <div className="mt-4">
            <button type="button" disabled={!!problem || busy} onClick={() => run(false)} className={button}>{busy ? "Checking…" : "Preview what will be imported"}</button>
          </div>
        </Card>
      )}

      {step === "preview" && report && (
        <>
          <Card title="2. Here is what will happen">
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="report">{describeReport(report).map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-3 text-sm text-muted">Nothing has been saved yet. Running this again later updates what is already here and never makes copies.</p>
          </Card>
          {report.warnings.length > 0 && (
            <Card title="Things to know">
              <ul className="list-disc space-y-1 pl-5 text-sm">{report.warnings.map((w) => <li key={w.code}>{warningLine(w)}</li>)}</ul>
            </Card>
          )}
          <Card title="What does not move over">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{report.unsupported.map((u) => <li key={u}>{u}</li>)}</ul>
          </Card>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(true)} className={button}>{busy ? "Importing…" : "Import now"}</button>
            <button type="button" disabled={busy} onClick={() => setStep("choose")} className={ghost}>Go back</button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <Card title="3. Done">
          <p data-testid="result">{result.created} new and {result.updated} updated products{result.skipped ? `, ${result.skipped} skipped` : ""}.</p>
          <div className="mt-3 flex gap-2">
            <Link href="/dashboard/catalog" className={button}>See your catalogue</Link>
            <button type="button" className={ghost} onClick={() => { setForm(empty); setReport(null); setResult(null); setStep("choose"); }}>Import more</button>
          </div>
        </Card>
      )}
    </div>
  );
}
