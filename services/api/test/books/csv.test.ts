import { describe, expect, it } from "vitest";
import { ledgerCsv, fixed } from "../../src/books/csv";
import { reconcile, type Inv, type Pay, type Ref, type Gas } from "../../src/books/reconcile";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const inv = (number: string, amount: bigint, over: Partial<Inv> = {}): Inv => ({
  id: `0x${"a".repeat(63)}${number.length % 10}`, number, amount, status: "paid", taxRateBps: null, taxLabel: null, dueDate: null,
  createdAt: "2026-11-01T00:00:00.000Z", createTxHash: H(900), earlyDiscount: null, ...over,
});
const month = (invoices: Inv[], payments: Pay[], refunds: Ref[] = [], gas: Gas[] = []) => reconcile({ period: "2026-11", invoices, payments, refunds, claims: [], gas });
const A = inv("INV-1", 10_000_000n, { taxRateBps: 1000, taxLabel: "VAT" });
const B = inv("=CMD|' /C calc'!A0", 5_500_000n);
const result = month(
  [A, B],
  [
    { id: "p1", invoiceId: A.id, payer: "0x2222222222222222222222222222222222222222", value: 10_000_000n, txHash: H(1), blockNumber: 1, at: "2026-11-02T10:00:00.000Z" },
    { id: "p2", invoiceId: B.id, payer: "0x3333333333333333333333333333333333333333", value: 5_500_000n, txHash: H(2), blockNumber: 2, at: "2026-11-04T09:30:00.000Z" },
  ],
  [{ id: "r1", invoiceId: A.id, to: "0x2222222222222222222222222222222222222222", value: 2_500_000n, txHash: H(3), blockNumber: 3, at: "2026-11-05T08:00:00.000Z" }],
  [{ id: "g1", txHash: H(4), kind: "pay", wei: 2_000_000_000_000_000n, at: "2026-11-02T10:00:01.000Z" }],
);
const rows = (f: Parameters<typeof ledgerCsv>[1]) => ledgerCsv(result, f).trim().split("\r\n");

describe("fixed-point text", () => {
  it("keeps at least the minimum places and trims the rest", () => {
    expect(fixed(10_000_000n, 6, 2)).toBe("10.00");
    expect(fixed(-2_500_000n, 6, 2)).toBe("-2.50");
    expect(fixed(1_234_567n, 6, 2)).toBe("1.234567");
    expect(fixed(2_000_000_000_000_000n, 18, 2)).toBe("0.002");
    expect(fixed(0n, 6, 2)).toBe("0.00");
  });
});

describe("ledger layout", () => {
  const lines = rows("ledger");
  it("has every ledger line, with both sides, currency, a leaf id and the explorer link", () => {
    expect(lines[0]).toBe("seq,date,type,invoice,description,debit_account,credit_account,amount,currency,usdt_value,tx_hash,explorer_url,leaf_id,adjustment_for");
    expect(lines).toHaveLength(1 + result.lines.length);
    expect(lines[1]).toMatch(/^1,2026-11-02T10:00:00.000Z,payment,INV-1,.*,Cash \(USDT\),Sales revenue,10.00,USDT,,0x0*1,https:\/\/explorer\.testnet\.whitechain\.io\/tx\/0x0*1,0x[0-9a-f]{64},$/);
    expect(lines.some((l) => l.includes(",tax,") && l.includes("Tax payable (VAT)") && l.includes(",0.90909,USDT,"))).toBe(true);
    expect(lines.find((l) => l.includes(",gas,"))).toContain(",0.002,WBT,,");
  });
  it("quotes commas and quotes, and defuses spreadsheet formulas (amounts here are always positive; direction is the debit and credit)", () => {
    const text = lines.join("\n");
    expect(text).toContain("'=CMD|' /C calc'!A0");
    expect(text).not.toMatch(/(^|,)=CMD/m);
    expect(lines.find((l) => l.includes(",refund,"))).toContain(",Refunds to customers,Cash (USDT),2.50,USDT,");
  });
});

describe("Xero layout (unverified against Xero's own template)", () => {
  const lines = rows("xero");
  it("lists only USDT cash movements, signed, with ISO dates", () => {
    expect(lines[0]).toBe("*Date,*Amount,Payee,Description,Reference");
    expect(lines).toHaveLength(4); // 2 payments + 1 refund; tax and gas lines are not bank movements
    expect(lines[1]).toMatch(/^2026-11-02,10.00,,.*,INV-1$/);
    expect(lines[3]).toMatch(/^2026-11-05,-2.50,,.*,INV-1$/);
  });
  it("defuses formulas in the invoice reference", () => {
    expect(lines.join("\n")).toContain("'=CMD|' /C calc'!A0");
  });
});

describe("QuickBooks layout", () => {
  it("keeps the existing Date, Description, Amount upload layout", () => {
    const lines = rows("quickbooks");
    expect(lines[0]).toBe("Date,Description,Amount");
    expect(lines[1]).toMatch(/^11\/02\/2026,Payment INV-1 from 0x2222222222222222222222222222222222222222,10.00$/);
    expect(lines[3]).toMatch(/,-2\.50$/);
  });
});
