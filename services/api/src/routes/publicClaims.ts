import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Address } from "viem";
import { fromUnits, whitechainSepolia } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { liveClaim } from "../claims";
import { invoices, merchants, payments } from "../db/schema";
import { fail } from "../errors";
import { clientIp } from "../lib/request";
import { hitRateLimit } from "../relayer/caps";

export const publicClaimRoutes = new Hono<AppEnv>();

const idParam = /^0x[0-9a-f]{64}$/;
const explorerTx = (hash: string) => `${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`;
const tx = (hash: string | null) => (hash ? { txHash: hash, url: explorerTx(hash) } : null);

/** 0x1234…abcd: enough to recognise an address, not to copy it. */
export const shortAddress = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : null);

/** Does what our database says match what the contract says? `funding` is our own in-flight state: the contract still says listed, or already funded. */
export function confirmStatus(db: string, chain: string): boolean {
  if (db === "funding") return chain === "listed" || chain === "funded";
  return db === chain;
}

/**
 * A receivable certificate for anyone with the link (no login). Only facts that are already public on the chain, plus the
 * invoice number when the business chose to show it. The status is the database's, checked against the contract: if the
 * two disagree, or the chain cannot be read, it says "unconfirmed" and never guesses.
 */
publicClaimRoutes.get("/claims/:id", async (c) => {
  const { db, chain, env } = { db: c.var.db, chain: c.var.chain, env: c.env };
  const ok = await hitRateLimit(db, `public-claim:ip:${clientIp(c) ?? "unknown"}`, 120, 60, c.var.now());
  if (!ok) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
  const id = c.req.param("id");
  const row = idParam.test(id) ? await liveClaim(db, id) : null;
  if (!row || row.status === "pending" || row.status === "sending") return fail(c, 404, "not_found", "Claim not found");

  let onchain: string | null = null;
  try {
    onchain = (await chain.claimState(row.invoiceId as `0x${string}`)).status;
  } catch (e) {
    console.error("claim state lookup failed", e);
  }
  const confirmed = onchain !== null && confirmStatus(row.status, onchain);
  const confirmation = confirmed
    ? { state: "confirmed", onchainStatus: onchain }
    : onchain === null
      ? { state: "unconfirmed", databaseStatus: row.status, onchainStatus: null, reason: "chain_unavailable" }
      : { state: "unconfirmed", databaseStatus: row.status, onchainStatus: onchain, reason: "mismatch" };

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, row.invoiceId));
  // The buyer: a Stenmont business when the invoice names one, otherwise whoever paid it.
  let buyer: string | null = null;
  if (inv?.buyerMerchantId) buyer = (await db.select().from(merchants).where(eq(merchants.id, inv.buyerMerchantId)))[0]?.address ?? null;
  if (!buyer) buyer = (await db.select().from(payments).where(eq(payments.invoiceId, row.invoiceId)).limit(1))[0]?.payer ?? null;
  let payerRecord: { score: number; paid: number } | null = null;
  if (buyer) {
    try {
      const r = await chain.reputationOf(buyer as Address);
      payerRecord = { score: r.score, paid: r.onTime + r.late };
    } catch (e) {
      console.error("reputation lookup failed", e);
    }
  }

  const face = BigInt(row.face);
  const price = BigInt(row.price);
  const closeKind = row.status === "settled" || row.status === "defaulted" ? row.status : null;
  return c.json({
    invoiceId: row.invoiceId,
    tokenId: BigInt(row.invoiceId).toString(),
    contract: env.INVOICE_CLAIM_ADDRESS,
    chainId: whitechainSepolia.id,
    status: confirmed ? row.status : "unconfirmed",
    confirmation,
    invoiceNumber: row.showInvoiceNumber === 1 && inv ? inv.number : null,
    face: fromUnits(face),
    price: fromUnits(price),
    discount: fromUnits(face - price),
    discountBps: row.discountBps,
    dueDate: new Date(row.dueDate * 1000).toISOString(),
    holder: shortAddress(row.investor),
    transactions: {
      list: tx(row.listTxHash),
      fund: tx(row.fundTxHash),
      close: closeKind && row.closeTxHash ? { kind: closeKind, ...tx(row.closeTxHash) } : null,
    },
    times: { listedAt: row.listedAt, fundedAt: row.fundedAt, closedAt: row.closedAt },
    payerRecord,
  });
});
