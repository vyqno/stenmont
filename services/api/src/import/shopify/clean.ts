import { slugify } from "../../catalog/schemas";
import type { Warnings } from "./types";

export const MAX_ROWS = 50_000;

/** Text that a spreadsheet would run as a formula gets a leading apostrophe (the same rule as our accountant export); control characters go. */
export function safeText(raw: string | undefined, w: Warnings, max = 500): string {
  const v = (raw ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) {
    w.add("formula_text", "Some text started with =, +, - or @ (which a spreadsheet could run as a formula). It was kept with a leading apostrophe.");
    return `'${v}`;
  }
  return v;
}

/** Shopify's handle is already a slug; anything else is turned into one so the same product always gets the same key. */
export const normalHandle = (raw: string): string => (/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(raw) ? raw : slugify(raw));

/** "1,234.50" -> "1234.50", "12" -> "12". Null for anything else (negative, symbols, European "1.234,50", more than 6 decimals). */
export function parseMoney(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (/^\d{1,3}(,\d{3})+(\.\d{1,6})?$/.test(v)) return v.replaceAll(",", "");
  return /^\d+(\.\d{1,6})?$/.test(v) ? v : null;
}

/** Shopify prefixes some ids with an apostrophe in CSV exports so Excel keeps them as text. */
export const stripQuote = (s: string | undefined) => (s ?? "").trim().replace(/^'/, "");

export const isEmail = (s: string) => s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s);

export function parseBool(raw: string | undefined): boolean {
  return /^(true|yes|1)$/i.test((raw ?? "").trim());
}
