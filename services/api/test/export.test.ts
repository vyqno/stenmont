import { describe, expect, it } from "vitest";
import { invoices, payments, refunds } from "../src/db/schema";
import { MERCHANT_ADDRESS, seedMerchant, setup } from "./helpers/app";
import { dbOf, seedInvoice } from "./helpers/fixtures";

const PAYER = "0x2222222222222222222222222222222222222222";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

async function seed(t: ReturnType<typeof setup>) {
  const key = await seedMerchant(t.db);
  const db = dbOf(t.db);
  const a = await seedInvoice(t.db, "INV-1", 10_000_000n);
  const b = await seedInvoice(t.db, "=CMD|' /C calc'!A0", 5_500_000n);
  await db.update(invoices).set({ customerEmail: 'ana, "the boss" <a@b.co>' }).where((await import("drizzle-orm")).eq(invoices.id, a));
  await db.insert(payments).values([
    { id: "p1", invoiceId: a, payer: PAYER, value: "10000000", txHash: H(1), logIndex: 0, blockNumber: 1, createdAt: "2026-11-02T10:00:00.000Z" },
    { id: "p2", invoiceId: b, payer: PAYER, value: "5500000", txHash: H(2), logIndex: 0, blockNumber: 2, createdAt: "2026-11-04T09:30:00.000Z" },
  ]);
  await db.insert(refunds).values({ id: "r1", invoiceId: a, toAddress: PAYER, value: "2500000", txHash: H(3), logIndex: 0, blockNumber: 3, createdAt: "2026-11-05T08:00:00.000Z" });
  return key;
}
const csv = async (t: ReturnType<typeof setup>, key: string, qs = "") => {
  const res = await t.req(`/v1/exports/payments.csv${qs}`, { key });
  return { res, text: await res.text() };
};

describe("GET /v1/exports/payments.csv", () => {
  it("lists payments and refunds, oldest first, with signed amounts and a header", async () => {
    const t = setup();
    const key = await seed(t);
    const { res, text } = await csv(t, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="stenmont-payments-/);
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("date,type,invoice,customer,counterparty,amount,currency,tx_hash,explorer_url");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("2026-11-02T10:00:00.000Z,payment,INV-1,");
    expect(lines[1]).toContain(",10.00,USDT,");
    expect(lines[3]).toContain(",refund,INV-1,");
    expect(lines[3]).toContain(",-2.50,USDT,");
    expect(lines[3]).toContain(`https://explorer.testnet.whitechain.io/tx/${H(3)}`);
  });
  it("quotes commas and quotes, and defuses spreadsheet formulas", async () => {
    const t = setup();
    const key = await seed(t);
    const { text } = await csv(t, key);
    expect(text).toContain('"ana, ""the boss"" <a@b.co>"'); // RFC 4180 quoting
    expect(text).toContain("'=CMD|' /C calc'!A0"); // a leading = would run as a formula in Excel
    expect(text).not.toMatch(/(^|,)=CMD/m);
    expect(text).toContain(",-2.50,"); // real negative numbers stay numbers
  });
  it("filters by date, inclusive, and rejects bad dates", async () => {
    const t = setup();
    const key = await seed(t);
    expect((await csv(t, key, "?from=2026-11-03&to=2026-11-04")).text.trim().split("\r\n")).toHaveLength(2);
    expect((await csv(t, key, "?from=2026-11-05")).text.trim().split("\r\n")).toHaveLength(2);
    for (const bad of ["?from=yesterday", "?to=2026-13-40", "?from=2026-11-05&to=2026-11-01", "?format=pdf"]) {
      expect((await csv(t, key, bad)).res.status).toBe(400);
    }
  });
  it("writes the QuickBooks bank-upload layout: Date, Description, Amount", async () => {
    const t = setup();
    const key = await seed(t);
    const { text } = await csv(t, key, "?format=quickbooks");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Description,Amount");
    expect(lines[1]).toMatch(/^11\/02\/2026,Payment INV-1 from 0x2222…2222,10\.00$/);
    expect(lines[3]).toMatch(/^11\/05\/2026,Refund INV-1 to 0x2222…2222,-2\.50$/);
  });
  it("only ever exports the signed-in business's own rows", async () => {
    const t = setup();
    const key = await seed(t);
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await csv(t, other)).text.trim().split("\r\n")).toHaveLength(1); // header only
    expect((await csv(t, key)).text).toContain("INV-1");
    expect((await t.req("/v1/exports/payments.csv")).status).toBe(401);
    void MERCHANT_ADDRESS;
  });
});
