import { ImportError } from "./types";
import { MAX_ROWS } from "./clean";

export const MAX_CSV_CHARS = 25_000_000;

/**
 * RFC 4180 reader for Shopify's exports: a leading BOM, CRLF / LF / CR line ends, quoted fields with commas, line breaks and "" escapes.
 * It walks the text once and stops with an error past `maxRows` data rows, so a huge file cannot run the Worker out of time or memory.
 * Header names are matched without case or surrounding spaces.
 * ponytail: reads a string already in memory (the request body is capped). Switch to a stream if files above ~25 MB are needed.
 */
export function parseCsv(text: string, maxRows = MAX_ROWS): { header: string[]; rows: Record<string, string>[] } {
  if (text.length > MAX_CSV_CHARS) throw new ImportError("file_too_large", "That file is too large. Split it and import in parts.");
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let any = false; // saw anything on this line
  const endRow = () => {
    row.push(field);
    field = "";
    if (any && !(row.length === 1 && row[0] === "")) records.push(row);
    row = [];
    any = false;
    if (records.length > maxRows + 1) throw new ImportError("too_many_rows", `That file has more than ${maxRows} rows. Split it and import in parts.`);
  };
  for (; i < n; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      any = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      any = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      any = true;
    }
  }
  if (quoted) throw new ImportError("bad_csv", "The file ends inside a quoted value. It looks cut off or damaged.");
  if (any || field !== "") endRow();
  const [head, ...data] = records;
  if (!head) return { header: [], rows: [] };
  const header = head.map((h) => h.trim().toLowerCase());
  return {
    header,
    rows: data.map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ""]))),
  };
}
