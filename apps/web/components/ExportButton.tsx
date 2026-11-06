"use client";

import { useState } from "react";
import { api } from "../lib/auth";

/** Downloads the accountant CSV (every payment in and refund out). */
export function ExportButton() {
  const [format, setFormat] = useState<"generic" | "quickbooks">("generic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const csv = await api.text(`/v1/exports/payments.csv?format=${format}`);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `stenmont-payments-${format}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label className="sr-only" htmlFor="export-format">Export format</label>
      <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className="rounded border border-line bg-surface px-2 py-1">
        <option value="generic">Spreadsheet (CSV)</option>
        <option value="quickbooks">QuickBooks upload</option>
      </select>
      <button type="button" onClick={download} disabled={busy} className="rounded border border-line px-3 py-1 hover:border-brand disabled:opacity-50">
        {busy ? "Preparing…" : "Export for your accountant"}
      </button>
      {error && <span role="status" className="text-danger">{error}</span>}
    </span>
  );
}
