/** RFC 4180 quoting, and a leading apostrophe on text that a spreadsheet would run as a formula (= + - @ tab CR). */
export function cell(value: string, text = true): string {
  const v = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}
export const row = (cells: string[]) => cells.join(",");
