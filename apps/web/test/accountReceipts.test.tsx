import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentReceipts } from "../app/account/PaymentReceipts";

describe("customer payment receipts", () => {
  it("labels replacement receipts and observed dates, preserves the real receipt link and exposes no money action", () => {
    const url = `https://explorer.testnet.whitechain.io/tx/0x${"e5".repeat(32)}`;
    const html = renderToStaticMarkup(<PaymentReceipts payments={[{ invoiceNumber: "INV-1", merchantName: "Acme", amount: "33.333334", at: "2026-11-05T10:00:00.000Z", receiptUrl: url, rail: "replacement_subscription", timeBasis: "observed" }]} />);
    expect(html).toContain("Replacement plan payment");
    expect(html).toContain("Receipt recorded");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("$33.333334");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/refund|cancel|subscription-cancel/i);
  });
  it("keeps ordinary payments distinct and escapes business text", () => {
    const html = renderToStaticMarkup(<PaymentReceipts payments={[{ invoiceNumber: "INV-1", merchantName: "<script>send()</script>", amount: "5", at: "2026-11-05T10:00:00.000Z", receiptUrl: "https://example.test/actual" }]} />);
    expect(html).not.toContain("Replacement plan payment");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
