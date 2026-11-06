"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";
import { Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { buildImportRequest, describeReport, formProblem, importMessage, isRate, warningLine, type ImportForm, type Report } from "../../../lib/catalog";
import { connectedRequest, connectProblem, connectRequest, isShopifyConsentUrl, returnFromShopify } from "../../../lib/shopifyConnect";

const field = "mt-1 block w-full rounded border border-line bg-surface px-3 py-2 text-sm";
const button = "rounded bg-brand px-4 py-2 text-sm font-medium text-on-brand disabled:cursor-not-allowed disabled:opacity-50";
const ghost = "rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50";
const empty: ImportForm = { source: "csv", currency: "USD", rate: "", includeCustomers: false, files: {}, shop: "", token: "" };

type Step = "choose" | "preview" | "done";
type Method = "connect" | "csv" | "api";
/** A store connected with one click: the server holds the access token (sealed, 15 minutes); the browser only knows the shop. */
type Link = { shop: string; needsRate: boolean; currency: string | null };

export default function ImportWizard() {
  const [form, setForm] = useState<ImportForm>(empty);
  const [step, setStep] = useState<Step>("choose");
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState<Method>("connect");
  const [storeName, setStoreName] = useState("");
  const [link, setLink] = useState<Link | null>(null);
  const set = (patch: Partial<ImportForm>) => setForm((f) => ({ ...f, ...patch }));
  const problem = method === "connect" ? (link ? (isRate(form.rate) ? null : "Enter what one unit of your currency is worth in USDT.") : connectProblem(storeName)) : formProblem(form);

  // Back from Shopify's own page: show the dry-run report that the server already made (or the reason it could not).
  useEffect(() => {
    const back = returnFromShopify(window.location.search);
    if (!back) return;
    window.history.replaceState(null, "", window.location.pathname);
    type Conn = { shop: string; includeCustomers: boolean; currency: string | null; report: Report | null; needsRate: boolean };
    const settled: Promise<string | null> =
      back.kind === "error"
        ? Promise.resolve(back.message)
        : api.get<{ connection: Conn | null }>("/v1/import/shopify/connection").then(
            ({ connection }) => {
              if (!connection) return "The connection expired. Connect your store again.";
              setLink({ shop: connection.shop, needsRate: connection.needsRate, currency: connection.currency });
              set({ includeCustomers: connection.includeCustomers });
              if (connection.report) {
                setReport(connection.report);
                setStep("preview");
              }
              return null;
            },
            () => "We could not load your connection. Connect your store again.",
          );
    void settled.then((message) => message && setError(message));
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const out = await api.post<{ authorizeUrl: string }>("/v1/import/shopify/connect", connectRequest(storeName, form.includeCustomers));
      if (!isShopifyConsentUrl(out.authorizeUrl)) throw new Error("unexpected address");
      window.location.assign(out.authorizeUrl); // Shopify's own page: sign in, click Install once, come back here
    } catch (e) {
      setError(e instanceof AuthError ? importMessage(e.code, e.message) : "We could not start the connection. Try again.");
      setBusy(false);
    }
  }

  async function disconnect() {
    await api.delete("/v1/import/shopify/connection").catch(() => {}); // best effort: it expires by itself in 15 minutes
    setLink(null);
    setReport(null);
    setStep("choose");
  }

  async function pick(kind: "products" | "customers" | "orders", e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    set({ files: { ...form.files, [kind]: file ? await file.text() : undefined } });
  }

  async function run(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      const body = link ? connectedRequest(link.shop, form.rate, confirm) : buildImportRequest(form, confirm);
      if (!confirm) {
        setReport((await api.post<{ report: Report }>("/v1/import/shopify/preview", body)).report);
        setStep("preview");
      } else {
        const out = await api.post<{ report: Report; result: { created: number; updated: number; skipped: number } }>("/v1/import/shopify/commit", body);
        setResult(out.result);
        setForm((f) => ({ ...f, token: "", files: {} })); // the token and the files are not kept once the import has run
        setLink(null); // the server has already deleted its sealed copy
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
            {(["connect", "csv", "api"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => { setMethod(m); setError(""); if (m !== "connect") set({ source: m }); }} className={`${ghost} ${method === m ? "border-brand" : ""}`}>
                {m === "connect" ? "Connect your Shopify store" : m === "csv" ? "Upload Shopify export files" : "Paste an access token"}
              </button>
            ))}
          </div>

          {method === "connect" ? (
            <div className="mt-4 flex flex-col gap-3">
              {link ? (
                <p className="text-sm" data-testid="connected">Connected to <strong>{link.shop}</strong>. {link.currency ? `Your prices are in ${link.currency}, so we need your rate before we can show what will be imported.` : "Tell us your currency and rate."}</p>
              ) : (
                <>
                  <p className="text-sm text-muted">You go to Shopify, click Install once, and come back here with everything ready to check. We ask only for read-only access. The connection is kept encrypted for 15 minutes and deleted as soon as the import has run.</p>
                  <label className="text-sm">Your store name
                    <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={field} placeholder="your-store" autoComplete="off" spellCheck={false} data-testid="store-name" />
                    <span className="text-xs text-muted">The part before .myshopify.com</span>
                  </label>
                </>
              )}
            </div>
          ) : form.source === "csv" ? (
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

          {(method === "connect" ? !!link?.needsRate : form.currency.trim().toUpperCase() !== "USD" || form.source === "api") && (
            <label className="mt-3 block text-sm">
              {method === "api" ? "Rate to USDT (needed only if your store does not sell in dollars)" : `What is one ${(method === "connect" ? link?.currency : form.currency.trim().toUpperCase()) || "unit"} worth in USDT?`}
              <input value={form.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" className={field} placeholder="for example 1.08" />
              <span className="text-xs text-muted">You enter the rate. We never look one up or guess.</span>
            </label>
          )}

          <fieldset className="mt-4 rounded border border-line p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.includeCustomers} disabled={!!link} onChange={(e) => set({ includeCustomers: e.target.checked })} className="mt-1" />
              <span>Also bring customers and past orders<br /><span className="text-muted">This is personal data. We keep only name, email, country and whether they agreed to marketing, and for orders the status, date and total. No addresses, phone numbers or notes.</span></span>
            </label>
            {form.includeCustomers && method === "csv" && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm">Customers file<input type="file" accept=".csv,text/csv" onChange={(e) => pick("customers", e)} className={field} /></label>
                <label className="text-sm">Orders file<input type="file" accept=".csv,text/csv" onChange={(e) => pick("orders", e)} className={field} /></label>
              </div>
            )}
          </fieldset>

          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          {problem && <p className="mt-3 text-sm text-muted">{problem}</p>}
          <div className="mt-4">
            {method === "connect" && !link ? (
              <button type="button" disabled={!!problem || busy} onClick={connect} className={button}>{busy ? "Opening Shopify…" : "Connect to Shopify"}</button>
            ) : (
              <div className="flex gap-2">
                <button type="button" disabled={!!problem || busy} onClick={() => run(false)} className={button}>{busy ? "Checking…" : "Preview what will be imported"}</button>
                {link && <button type="button" disabled={busy} onClick={disconnect} className={ghost}>Disconnect</button>}
              </div>
            )}
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
            <button type="button" disabled={busy} onClick={() => (link ? disconnect() : setStep("choose"))} className={ghost}>{link ? "Cancel and disconnect" : "Go back"}</button>
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
