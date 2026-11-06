import { describeReputation, type Reputation } from "./financing";
import { formatAmount } from "./pay";
import { formatDay } from "./financingTimeline";

/** What `GET /public/claims/:id` returns. Everything in it is already public on the chain, or chosen by the business. */
export type Certificate = {
  invoiceId: string;
  tokenId: string;
  contract: string;
  chainId: number;
  status: string; // listed | funding | funded | settled | defaulted | cancelled | unconfirmed
  confirmation: { state: "confirmed"; onchainStatus: string } | { state: "unconfirmed"; databaseStatus: string; onchainStatus: string | null; reason: "mismatch" | "chain_unavailable" };
  invoiceNumber: string | null;
  face: string;
  price: string;
  discount: string;
  discountBps: number;
  dueDate: string;
  holder: string | null;
  transactions: {
    list: { txHash: string; url: string } | null;
    fund: { txHash: string; url: string } | null;
    close: { kind: "settled" | "defaulted"; txHash: string; url: string } | null;
  };
  times: { listedAt: string | null; fundedAt: string | null; closedAt: string | null };
  payerRecord: Reputation;
};

export type CertificateTone = "ok" | "wait" | "warn" | "bad" | "off";

export function certificateStatus(c: Certificate): { label: string; tone: CertificateTone; explanation: string } {
  if (c.status === "unconfirmed" || c.confirmation.state === "unconfirmed") {
    const why =
      c.confirmation.state === "unconfirmed" && c.confirmation.reason === "chain_unavailable"
        ? "The public record could not be read just now, so this status could not be checked."
        : "Our records and the public record do not match right now.";
    return { label: "Unconfirmed", tone: "warn", explanation: `${why} Check the claim on the explorer before relying on this page.` };
  }
  switch (c.status) {
    case "listed": return { label: "For sale", tone: "wait", explanation: "The business offered this invoice to approved investors at a discount. Nobody has bought it yet." };
    case "funding":
    case "funded": return { label: "Sold, waiting for the customer to pay", tone: "wait", explanation: "An approved investor bought this invoice. When the customer pays, the money goes straight to whoever holds the claim." };
    case "settled": return { label: "Settled: paid in full", tone: "ok", explanation: "The customer paid and the holder received the full invoice amount." };
    case "defaulted": return { label: "Defaulted", tone: "bad", explanation: "The customer did not pay within a week after the due date. The amount the business held back went to the holder." };
    case "cancelled": return { label: "Offer ended without a sale", tone: "off", explanation: "The invoice was paid or withdrawn before anyone bought it." };
    default: return { label: c.status, tone: "off", explanation: "" };
  }
}

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export function certificateFacts(c: Certificate): { label: string; value: string }[] {
  const facts = [
    ...(c.invoiceNumber ? [{ label: "Invoice number", value: c.invoiceNumber }] : []),
    { label: "Face value", value: formatAmount(c.face) },
    { label: "Sold for", value: formatAmount(c.price) },
    { label: "Discount", value: `${formatAmount(c.discount)} (${pct(c.discountBps)})` },
    { label: "Due date", value: formatDay(c.dueDate) },
    { label: "Holder", value: c.holder ?? "Nobody yet" },
    { label: "Token id", value: c.tokenId },
    { label: "Buyer's payment record", value: describeReputation(c.payerRecord) },
  ];
  return facts;
}

const EXPLORER = "https://explorer.testnet.whitechain.io";
export function certificateLinks(c: Certificate): { label: string; url: string }[] {
  const out = [
    { label: "Claim contract", url: `${EXPLORER}/address/${c.contract}` },
    { label: "This claim's token", url: `${EXPLORER}/token/${c.contract}/instance/${c.tokenId}` },
  ];
  if (c.transactions.list) out.push({ label: "Listed", url: c.transactions.list.url });
  if (c.transactions.fund) out.push({ label: "Funded", url: c.transactions.fund.url });
  if (c.transactions.close) out.push({ label: c.transactions.close.kind === "settled" ? "Settled" : "Defaulted", url: c.transactions.close.url });
  return out;
}
