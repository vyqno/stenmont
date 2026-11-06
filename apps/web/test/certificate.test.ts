import { describe, expect, it } from "vitest";
import { certificateFacts, certificateLinks, certificateStatus, type Certificate } from "../lib/certificate";

const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const cert: Certificate = {
  invoiceId: `0x${"ab".repeat(32)}`, tokenId: "123456789", contract: "0x2EB9aaF14A2d729BC3F185A144571fCd23454914", chainId: 1874, status: "funded",
  confirmation: { state: "confirmed", onchainStatus: "funded" }, invoiceNumber: null, face: "100", price: "95", discount: "5", discountBps: 500,
  dueDate: "2026-12-06T12:00:00.000Z", holder: "0x4444…4444",
  transactions: {
    list: { txHash: H(1), url: `https://explorer.testnet.whitechain.io/tx/${H(1)}` },
    fund: { txHash: H(2), url: `https://explorer.testnet.whitechain.io/tx/${H(2)}` },
    close: null,
  },
  times: { listedAt: "2026-11-06T10:01:00.000Z", fundedAt: "2026-11-06T10:05:00.000Z", closedAt: null },
  payerRecord: { score: 80, paid: 10 },
};

describe("certificateStatus", () => {
  it("names each state in plain words", () => {
    expect(certificateStatus(cert)).toMatchObject({ label: "Sold, waiting for the customer to pay", tone: "wait" });
    expect(certificateStatus({ ...cert, status: "settled" })).toMatchObject({ label: "Settled: paid in full", tone: "ok" });
    expect(certificateStatus({ ...cert, status: "defaulted" })).toMatchObject({ label: "Defaulted", tone: "bad" });
    expect(certificateStatus({ ...cert, status: "listed" })).toMatchObject({ label: "For sale", tone: "wait" });
    expect(certificateStatus({ ...cert, status: "cancelled" })).toMatchObject({ label: "Offer ended without a sale", tone: "off" });
  });
  it("shows unconfirmed, with the reason, when the database and the chain disagree or the chain is unreachable", () => {
    const mismatch = certificateStatus({ ...cert, status: "unconfirmed", confirmation: { state: "unconfirmed", databaseStatus: "funded", onchainStatus: "settled", reason: "mismatch" } });
    expect(mismatch).toMatchObject({ label: "Unconfirmed", tone: "warn" });
    expect(mismatch.explanation).toContain("do not match");
    const down = certificateStatus({ ...cert, status: "unconfirmed", confirmation: { state: "unconfirmed", databaseStatus: "funded", onchainStatus: null, reason: "chain_unavailable" } });
    expect(down.explanation).toContain("could not be read");
  });
});

describe("certificateFacts", () => {
  it("lists the public facts and hides what is not shared", () => {
    const f = certificateFacts(cert);
    expect(f).toEqual(expect.arrayContaining([
      { label: "Face value", value: "$100.00" }, { label: "Sold for", value: "$95.00" }, { label: "Discount", value: "$5.00 (5%)" },
      { label: "Due date", value: "6 Dec 2026" }, { label: "Holder", value: "0x4444…4444" }, { label: "Token id", value: "123456789" },
      { label: "Buyer's payment record", value: "Reliability 80, 10 invoices paid" },
    ]));
    expect(f.find((x) => x.label === "Invoice number")).toBeUndefined();
  });
  it("shows the invoice number only when the API sent it", () => {
    expect(certificateFacts({ ...cert, invoiceNumber: "INV-9" })).toEqual(expect.arrayContaining([{ label: "Invoice number", value: "INV-9" }]));
  });
  it("says so when there is no holder or no payment history yet", () => {
    const f = certificateFacts({ ...cert, status: "listed", holder: null, payerRecord: null });
    expect(f).toEqual(expect.arrayContaining([{ label: "Holder", value: "Nobody yet" }, { label: "Buyer's payment record", value: "No payment history yet" }]));
  });
});

describe("certificateLinks", () => {
  it("links the contract, the token and each transaction that exists", () => {
    const l = certificateLinks(cert);
    expect(l).toEqual([
      { label: "Claim contract", url: `https://explorer.testnet.whitechain.io/address/${cert.contract}` },
      { label: "This claim's token", url: `https://explorer.testnet.whitechain.io/token/${cert.contract}/instance/123456789` },
      { label: "Listed", url: cert.transactions.list!.url },
      { label: "Funded", url: cert.transactions.fund!.url },
    ]);
  });
  it("adds the settlement or default transaction", () => {
    const close = { kind: "settled" as const, txHash: H(3), url: `https://explorer.testnet.whitechain.io/tx/${H(3)}` };
    expect(certificateLinks({ ...cert, transactions: { ...cert.transactions, close } }).at(-1)).toEqual({ label: "Settled", url: close.url });
    expect(certificateLinks({ ...cert, transactions: { ...cert.transactions, close: { ...close, kind: "defaulted" } } }).at(-1)).toEqual({ label: "Defaulted", url: close.url });
  });
});
