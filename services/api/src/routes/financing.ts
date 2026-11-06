import { and, desc, eq, inArray, like, ne } from "drizzle-orm";
import { Hono } from "hono";
import { hashTypedData, type Address, type Hex } from "viem";
import { z } from "zod";
import { CLAIM_LIMITS, b64urlEncode, fromUnits, claimDomain, claimTermsTypes, encodeWebAuthnSignature, parseDerSignature, quoteClaim, routerDomain, setHookTypes } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { claimView, liveClaim } from "../claims";
import { Rejected } from "../chain";
import { auditLog, claims, investorEnrollments, invoices, payments } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { idSchema, invalid } from "../lib/validation";
import { loadLimits, merchantTier, refused, tierLimitResponse } from "../verification/store";
import { checkFinancing } from "../verification/tiers";
import { checkAssertion } from "./auth";

const SIGNING_SECONDS = 3_600;
const b64 = z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/);
const assertion = z.strictObject({ credentialId: b64, authenticatorData: b64, clientDataJSON: b64, signature: b64 });
const requestBody = z.strictObject({
  invoiceId: idSchema,
  discountBps: z.number().int().min(1).max(CLAIM_LIMITS.maxDiscountBps),
  reserveBps: z.number().int().min(0).max(CLAIM_LIMITS.maxReserveBps),
});
const submitBody = z.strictObject({ terms: assertion, hook: assertion });

const digestOf = (d: Hex) => b64urlEncode(Uint8Array.from(Buffer.from(d.slice(2), "hex")));

export const financingRoutes = new Hono<AppEnv>();

/** The merchant's offers, newest first (requests nobody signed are not shown). */
financingRoutes.get("/listings", async (c) => {
  const rows = await c.var.db.select().from(claims).where(and(eq(claims.merchantId, c.var.merchantId), ne(claims.status, "pending"))).orderBy(desc(claims.createdAt));
  return c.json({ listings: rows.map(claimView) });
});

/** The financing timeline: for each of the merchant's financed invoices, everything each step needs to show (amounts, times, transactions). */
financingRoutes.get("/timeline", async (c) => {
  const { db, merchantId } = c.var;
  const rows = await db.select().from(claims).where(and(eq(claims.merchantId, merchantId), ne(claims.status, "pending"), ne(claims.status, "sending"))).orderBy(desc(claims.createdAt));
  const ids = rows.map((r) => r.invoiceId);
  const invs = ids.length ? await db.select().from(invoices).where(and(eq(invoices.merchantId, merchantId), inArray(invoices.id, ids))) : [];
  const paid = ids.length ? await db.select().from(payments).where(inArray(payments.invoiceId, ids)).orderBy(payments.blockNumber) : [];
  const items = [];
  for (const r of rows) {
    const inv = invs.find((i) => i.id === r.invoiceId);
    if (!inv) continue; // a claim whose invoice is not this merchant's is never shown
    const view = claimView(r);
    let investor = null;
    if (r.investor) {
      const [enrol] = await db.select().from(investorEnrollments).where(eq(investorEnrollments.address, r.investor));
      // the investor's allowlist transaction is recorded in the audit log (account is already a validated lower-case address)
      const [allow] = await db.select().from(auditLog).where(and(eq(auditLog.action, "investor.allowed"), like(auditLog.payload, `%"account":"${r.investor}"%`))).orderBy(desc(auditLog.id)).limit(1);
      const allowTx = allow ? ((JSON.parse(allow.payload) as { txHash?: string }).txHash ?? null) : null;
      investor = { address: r.investor, verified: !!enrol, verifiedAt: enrol?.verifiedAt ?? null, allowTx };
    }
    items.push({
      claimId: r.id,
      invoiceId: r.invoiceId,
      invoiceNumber: inv.number,
      invoiceStatus: inv.status,
      status: r.status,
      showInvoiceNumber: r.showInvoiceNumber === 1,
      face: view.face,
      price: view.price,
      discount: fromUnits(BigInt(r.face) - BigInt(r.price)),
      reserve: view.reserve,
      advance: view.advance,
      discountBps: r.discountBps,
      reserveBps: r.reserveBps,
      amountPaid: fromUnits(BigInt(inv.amountPaid)),
      dueDate: view.dueDate,
      fundBy: view.fundBy,
      investor,
      times: { listedAt: r.listedAt, fundedAt: r.fundedAt, closedAt: r.closedAt },
      transactions: { list: r.listTxHash, fund: r.fundTxHash, close: r.closeTxHash },
      payments: paid.filter((p) => p.invoiceId === r.invoiceId).map((p) => ({ value: fromUnits(BigInt(p.value)), txHash: p.txHash, at: p.createdAt })),
    });
  }
  return c.json({ items });
});

/** The merchant's choice: may the public certificate show this invoice's number? Hidden by default. */
financingRoutes.post("/listings/:id/public-number", async (c) => {
  const parsed = z.strictObject({ showInvoiceNumber: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, merchant } = c.var;
  const [row] = await db.select().from(claims).where(and(eq(claims.id, c.req.param("id")), eq(claims.merchantId, merchant.id)));
  if (!row || row.status === "pending" || row.status === "sending") return fail(c, 404, "not_found", "Listing not found");
  await db.update(claims).set({ showInvoiceNumber: parsed.data.showInvoiceNumber ? 1 : 0, updatedAt: c.var.now().toISOString() }).where(eq(claims.id, row.id));
  await audit(db, { merchantId: merchant.id, actor: `merchant:${merchant.id}`, action: "claim.public_number", payload: { id: row.id, invoiceId: row.invoiceId, show: parsed.data.showInvoiceNumber } });
  return c.json({ id: row.id, showInvoiceNumber: parsed.data.showInvoiceNumber });
});

/**
 * Step 1: check the invoice can be sold and hand back the two digests the merchant's passkey must sign (the claim terms,
 * and the router's SetHook that sends this invoice's payments to the claim contract) plus the price. Nothing is sent.
 */
financingRoutes.post("/listings", async (c) => {
  const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { merchant, db, now: clock } = c.var;
  const b = parsed.data;
  if (!merchant.address) return fail(c, 404, "not_found", "Invoice not found");

  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, b.invoiceId), eq(invoices.merchantId, merchant.id)));
  if (!inv) return fail(c, 404, "not_found", "Invoice not found");
  // Selling needs tier 3 (World Proof of Human) or 4 (documents), and the invoice must be within the tier's financing cap.
  const { tier } = await merchantTier(db, merchant.id, clock());
  const gate = checkFinancing(await loadLimits(db), tier, BigInt(inv.amount));
  if (refused(gate)) return tierLimitResponse(c, gate, tier);
  const nowS = Math.floor(clock().getTime() / 1000);
  const due = inv.dueDate ? Math.floor(Date.parse(inv.dueDate) / 1000) : 0;
  if (inv.status !== "open" || BigInt(inv.amountPaid) !== 0n || BigInt(inv.amountRefunded) !== 0n)
    return fail(c, 422, "invoice_not_sellable", "Only an open invoice with no payment on it can be sold.");
  if (!due || due <= nowS + 3_600) return fail(c, 422, "invoice_not_sellable", "The invoice needs a due date at least an hour away.");

  const existing = await db.select().from(claims).where(eq(claims.invoiceId, inv.id));
  if (existing.some((r) => r.status !== "pending")) return fail(c, 409, "already_listed", "This invoice has already been offered for sale.");

  const face = BigInt(inv.amount);
  const { price, reserve } = quoteClaim(face, b.discountBps, b.reserveBps);
  if (price === 0n) return fail(c, 422, "invoice_not_sellable", "The price would be zero.");

  // The same request again returns the same waiting request, so a retry never produces a second thing to sign.
  const same = existing.find((r) => r.status === "pending" && r.expiresAt > nowS && r.discountBps === b.discountBps && r.reserveBps === b.reserveBps);
  const present = (r: typeof claims.$inferSelect, status: 200 | 201) =>
    c.json({ ...claimView(r), expiresAt: new Date(r.expiresAt * 1000).toISOString(), challenges: { terms: r.termsChallenge, hook: r.hookChallenge } }, status);
  if (same) return present(same, 200);

  const deadline = Math.min(due, nowS + CLAIM_LIMITS.listingDays * 86_400);
  const claimAddress = c.env.INVOICE_CLAIM_ADDRESS as Address;
  const terms = hashTypedData({ domain: claimDomain(claimAddress), types: claimTermsTypes, primaryType: "ClaimTerms", message: { invoiceId: inv.id as Hex, discountBps: b.discountBps, reserveBps: b.reserveBps, deadline: BigInt(deadline) } });
  const hook = hashTypedData({ domain: routerDomain(c.env.ROUTER_ADDRESS as Address), types: setHookTypes, primaryType: "SetHook", message: { id: inv.id as Hex, hook: claimAddress, deadline: BigInt(deadline) } });

  await db.delete(claims).where(and(eq(claims.invoiceId, inv.id), eq(claims.status, "pending"))); // an older request is replaced
  const stamp = clock().toISOString();
  const row = {
    id: `cl_${randomHex(12)}`,
    invoiceId: inv.id,
    merchantId: merchant.id,
    status: "pending",
    discountBps: b.discountBps,
    reserveBps: b.reserveBps,
    face: face.toString(),
    price: price.toString(),
    reserve: reserve.toString(),
    dueDate: due,
    deadline,
    termsChallenge: digestOf(terms),
    hookChallenge: digestOf(hook),
    expiresAt: Math.min(nowS + SIGNING_SECONDS, deadline),
    investor: null,
    listTxHash: null,
    fundTxHash: null,
    closeTxHash: null,
    leaseUntil: null,
    showInvoiceNumber: 0,
    listedAt: null,
    fundedAt: null,
    closedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await db.insert(claims).values(row);
  return present(row, 201);
});

/** Step 2: both passkey taps are done. Check them, then offer the invoice on chain. Safe to call again after success. */
financingRoutes.post("/listings/:id/submit", async (c) => {
  const parsed = submitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { merchant, db, chain } = c.var;
  const [row] = await db.select().from(claims).where(and(eq(claims.id, c.req.param("id")), eq(claims.merchantId, merchant.id)));
  if (!row) return fail(c, 404, "not_found", "Listing not found");
  if (row.status === "listed") return c.json(claimView(row)); // already done: the same answer, nothing sent again
  if (row.status !== "pending") return fail(c, 409, "already_submitted", "This listing was already submitted.");
  if (Math.floor(c.var.now().getTime() / 1000) >= row.expiresAt) return fail(c, 400, "expired", "This listing request expired. Start again.");

  const t = await checkAssertion(c, row.termsChallenge, parsed.data.terms, merchant.id);
  const hk = t ? await checkAssertion(c, row.hookChallenge, parsed.data.hook, merchant.id) : null;
  if (!t || !hk) return fail(c, 401, "unauthorized", "The passkey could not be verified.");

  const lock = await db.update(claims).set({ status: "sending" }).where(and(eq(claims.id, row.id), eq(claims.status, "pending"))).returning({ id: claims.id });
  if (lock.length === 0) return fail(c, 409, "already_submitted", "This listing is already being sent.");
  const unlock = () => db.update(claims).set({ status: "pending" }).where(and(eq(claims.id, row.id), eq(claims.status, "sending")));

  // the invoice may have been paid or cancelled while the merchant was signing
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, row.invoiceId));
  if (!inv || inv.status !== "open" || BigInt(inv.amountPaid) !== 0n) {
    await unlock();
    return fail(c, 422, "invoice_not_sellable", "Only an open invoice with no payment on it can be sold.");
  }
  try {
    const sig = (x: NonNullable<typeof t>) => {
      const { r, s } = parseDerSignature(x.parts.der);
      return encodeWebAuthnSignature({ r, s, authenticatorData: x.parts.authenticatorData, clientDataJSON: x.parts.clientDataJSON });
    };
    const { txHash } = await chain.listClaim({ invoiceId: row.invoiceId as Hex, discountBps: row.discountBps, reserveBps: row.reserveBps, deadline: BigInt(row.deadline), termsSig: sig(t), hookSig: sig(hk) });
    await db.update(claims).set({ status: "listed", listTxHash: txHash, listedAt: c.var.now().toISOString(), updatedAt: c.var.now().toISOString() }).where(eq(claims.id, row.id));
    await audit(db, { merchantId: merchant.id, actor: `passkey:${t.pk.id}`, action: "claim.listed", payload: { id: row.id, invoiceId: row.invoiceId, price: row.price, discountBps: row.discountBps, reserveBps: row.reserveBps, txHash } });
    const fresh = await liveClaim(db, row.invoiceId);
    return c.json(claimView(fresh!));
  } catch (e) {
    if (e instanceof Rejected) {
      // The chain says no: nothing was sent. A listing that already exists on chain is not a retry.
      await unlock(); // if it was in fact listed earlier (a lost reply), the indexer marks this row listed
      if (e.reason === "AlreadyListed") return fail(c, 409, "already_listed", "This invoice has already been offered for sale.");
      const code = e.reason === "InvoiceNotSellable" ? "invoice_not_sellable" : e.reason === "Expired" ? "expired" : e.reason === "BadSignature" ? "bad_signature" : "listing_rejected";
      return fail(c, 422, code, "The listing was rejected: " + e.reason);
    }
    await unlock();
    console.error("listing failed", e);
    return fail(c, 502, "chain_error", "The listing could not be sent right now. Try again.");
  }
});
