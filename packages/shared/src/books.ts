import { keccak256, stringToBytes, verifyMessage, type Address, type Hex } from "viem";
import { buildTree } from "./merkle";

/** Stable JSON: lexicographically sorted object keys, array order retained, bigint encoded as decimal strings. */
export function booksJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(booksJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${booksJson((value as Record<string,unknown>)[k])}`).join(",")}}`;
}
/** Domain-separated hash of the complete ledger line, including seq, accounts, currency and adjustment period. */
export function ledgerLineHash(merchantId: string, period: string, line: unknown): Hex {
  return keccak256(stringToBytes(booksJson(["stenmont.books.line.v1",merchantId,period,line])));
}
export type MonthBundle = {
  version: "stenmont.books.v1"; closeKind: "final_month" | "interim_staging"; merchantId: string; period: string; closedAt: string;
  root: Hex; lineCount: number; snapshot: {lines: unknown[]; [key:string]: unknown};
  signer: Address; signature: Hex;
};
export function bundleDigest(bundle: Omit<MonthBundle,"signature"> | MonthBundle): Hex {
  const { signature: _ignored, ...payload } = bundle as MonthBundle;
  return keccak256(stringToBytes(booksJson(payload)));
}
/** Pin expectedSigner from the service configuration, not from an untrusted bundle. No network needed. */
export async function verifyMonthBundle(bundle: MonthBundle, expectedSigner: Address): Promise<boolean> {
  try {
    if (bundle.version !== "stenmont.books.v1" || bundle.signer.toLowerCase() !== expectedSigner.toLowerCase()) return false;
    if (bundle.snapshot.period !== bundle.period || bundle.lineCount !== bundle.snapshot.lines.length) return false;
    const tree = buildTree(bundle.snapshot.lines.map(l => ledgerLineHash(bundle.merchantId,bundle.period,l)));
    return tree.root === bundle.root && await verifyMessage({address:expectedSigner,message:{raw:bundleDigest(bundle)},signature:bundle.signature});
  } catch { return false; }
}
