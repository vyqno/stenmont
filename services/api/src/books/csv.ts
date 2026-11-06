import { cell, row } from "../lib/csv";
import { ACCOUNTS, type Line, type Result } from "./reconcile";

const EXPLORER = "https://explorer.testnet.whitechain.io/tx/";

/** 2500000n, 6, 2 -> "2.50"; keeps at least `min` places, trims the rest of the trailing zeros. */
export function fixed(n: bigint, decimals: number, min: number): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const scale = 10n ** BigInt(decimals);
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(min, "0");
  return `${neg ? "-" : ""}${abs / scale}${frac ? `.${frac}` : ""}`;
}
const amountOf = (l: Line) => fixed(l.amount, l.currency === "WBT" ? 18 : 6, l.currency === "WBT" ? 3 : 2);

/** A bank-statement style row: only USDT lines that moved the cash account, positive in and negative out. */
const cashMoves = (r: Result) =>
  r.lines
    .filter((l) => l.currency === "USDT" && (l.debit === ACCOUNTS.cash || l.credit === ACCOUNTS.cash))
    .map((l) => ({ l, signed: l.debit === ACCOUNTS.cash ? l.amount : -l.amount }));

export type BooksFormat = "ledger" | "xero" | "quickbooks";

export function ledgerCsv(r: Result, format: BooksFormat): string {
  let out: string[];
  if (format === "xero") {
    // Header names follow third-party descriptions of Xero's statement template; not checked against Xero's own documentation.
    out = ["*Date,*Amount,Payee,Description,Reference", ...cashMoves(r).map(({ l, signed }) => row([l.date.slice(0, 10), fixed(signed, 6, 2), "", cell(l.description), cell(l.invoice ?? "")]))];
  } else if (format === "quickbooks") {
    out = [
      "Date,Description,Amount",
      ...cashMoves(r).map(({ l, signed }) => {
        const [y, m, d] = l.date.slice(0, 10).split("-");
        return row([`${m}/${d}/${y}`, cell(l.description), fixed(signed, 6, 2)]);
      }),
    ];
  } else {
    out = [
      "seq,date,type,invoice,description,debit_account,credit_account,amount,currency,usdt_value,tx_hash,explorer_url,leaf_id,adjustment_for",
      ...r.lines.map((l) =>
        row([
          String(l.seq), l.date, l.kind, cell(l.invoice ?? ""), cell(l.description), cell(l.debit ?? ""), cell(l.credit ?? ""), amountOf(l), l.currency,
          l.usdtValue === null ? "" : fixed(l.usdtValue, 6, 2), l.txHash ?? "", l.txHash ? EXPLORER + l.txHash : "", l.leafId ?? "", l.adjustmentFor ?? "",
        ]),
      ),
    ];
  }
  return out.join("\r\n") + "\r\n";
}
