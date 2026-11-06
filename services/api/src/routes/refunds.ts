import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { b64urlEncode, buildReceiveAuth, encodeWebAuthnSignature, fromUnits, parseDerSignature, refundApprovalTypes, refundNonce, refundOpHash, routerDomain, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { Rejected } from "../chain";
import { invoices, payments, refundRequests, refunds } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { amountSchema, idSchema, invalid } from "../lib/validation";
import { requireApproval } from "../world/approvals";
import { d1ApprovalRepo } from "../world/d1";
import { checkAssertion } from "./auth";

/** Refunds above this need a person's World approval, and the router needs the attester's signature. Must equal the router's threshold. */
const DEFAULT_APPROVAL_THRESHOLD = 100_000_000n;
const thresholdOf = (env: { REFUND_APPROVAL_THRESHOLD?: string }) => (env.REFUND_APPROVAL_THRESHOLD ? BigInt(env.REFUND_APPROVAL_THRESHOLD) : DEFAULT_APPROVAL_THRESHOLD);
const APPROVAL_DEADLINE_SECONDS = 900;
const VALID_FOR_SECONDS = 3_600;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const b64 = z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/);

const requestBody = z.strictObject({ invoiceId: idSchema, amount: amountSchema.optional(), to: address.optional() });
const submitBody = z.strictObject({ credentialId: b64, authenticatorData: b64, clientDataJSON: b64, signature: b64 });

export const refundRoutes = new Hono<AppEnv>();

/** What this payer can still get back: what they paid minus what was already refunded to them. */
async function refundable(c: { var: AppEnv["Variables"] }, invoiceId: string) {
  const paid = new Map<string, bigint>();
  for (const p of await c.var.db.select().from(payments).where(eq(payments.invoiceId, invoiceId))) {
    const k = p.payer.toLowerCase();
    paid.set(k, (paid.get(k) ?? 0n) + BigInt(p.value));
  }
  for (const r of await c.var.db.select().from(refunds).where(eq(refunds.invoiceId, invoiceId))) {
    const k = r.toAddress.toLowerCase();
    if (paid.has(k)) paid.set(k, paid.get(k)! - BigInt(r.value));
  }
  return paid;
}

const view = (r: typeof refundRequests.$inferSelect) => ({
  id: r.id,
  invoiceId: r.invoiceId,
  to: r.toAddress,
  amount: fromUnits(BigInt(r.value)),
  status: r.status,
  txHash: r.txHash,
});

/** Step 1: work out the refund and hand back the digest the merchant's passkey must sign. Nothing is sent yet. */
refundRoutes.post("/", async (c) => {
  const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { merchant, db } = c.var;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, parsed.data.invoiceId), eq(invoices.merchantId, merchant.id)));
  if (!inv || !merchant.address) return fail(c, 404, "not_found", "Invoice not found");

  const left = await refundable(c, inv.id);
  const open = [...left].filter(([, v]) => v > 0n);
  let to = parsed.data.to?.toLowerCase();
  if (!to) {
    if (open.length !== 1) return fail(c, 422, open.length ? "to_required" : "nothing_to_refund", open.length ? "Say who to refund." : "There is nothing left to refund on this invoice.");
    to = open[0]![0];
  }
  const max = left.get(to) ?? 0n;
  if (max <= 0n) return fail(c, 422, "nothing_to_refund", "That address has nothing left to refund on this invoice.");
  const value = parsed.data.amount ? toUnits(parsed.data.amount) : max;
  if (value > max) return fail(c, 422, "refund_too_large", `At most ${fromUnits(max)} can be refunded to that address.`);
  // The threshold counts everything refunded on this invoice plus requests still waiting, so a big refund cannot be split to avoid approval.
  const nowS = Math.floor(c.var.now().getTime() / 1000);
  const waiting = (await db.select().from(refundRequests).where(and(eq(refundRequests.invoiceId, inv.id), inArray(refundRequests.status, ["pending", "sending"])))).filter((r) => r.validBefore > nowS);
  const committed = BigInt(inv.amountRefunded) + waiting.reduce((sum, r) => sum + BigInt(r.value), 0n);
  let approved = false;
  if (committed + value > thresholdOf(c.env)) {
    // What the person must approve, spelled out so the dashboard can ask World for exactly this.
    const approvalParams = { invoiceId: inv.id, amount: fromUnits(value), to };
    const gate = await requireApproval(d1ApprovalRepo(db), { merchantId: merchant.id, operation: "refund", params: approvalParams, now: c.var.now() });
    if (!gate.ok) return fail(c, 409, gate.code, gate.message, { approvalParams });
    approved = true;
  }

  const salt = `0x${randomHex(32)}` as Hex;
  const validBefore = Math.floor(c.var.now().getTime() / 1000) + VALID_FOR_SECONDS;
  const digest = hashTypedData(
    buildReceiveAuth({
      from: merchant.address as Address,
      to: c.env.ROUTER_ADDRESS as Address,
      value,
      validAfter: 0n,
      validBefore: BigInt(validBefore),
      nonce: refundNonce(inv.id as Hex, to as Address, salt),
    }),
  );
  const challenge = b64urlEncode(Uint8Array.from(Buffer.from(digest.slice(2), "hex")));
  const row = {
    id: `rf_${randomHex(12)}`,
    merchantId: merchant.id,
    invoiceId: inv.id,
    toAddress: to,
    value: value.toString(),
    salt,
    validBefore,
    challenge,
    requiresAttester: approved ? 1 : 0,
    status: "pending",
    txHash: null,
    createdAt: c.var.now().toISOString(),
  };
  await db.insert(refundRequests).values(row);
  return c.json({ ...view(row), challenge, approved, authorization: { salt, validBefore } }, 201);
});

/** Step 2: the passkey has signed. Check it, then let the router redeem it. */
refundRoutes.post("/:id/submit", async (c) => {
  const parsed = submitBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { merchant, db, chain } = c.var;
  const [req] = await db.select().from(refundRequests).where(and(eq(refundRequests.id, c.req.param("id")), eq(refundRequests.merchantId, merchant.id)));
  if (!req) return fail(c, 404, "not_found", "Refund not found");
  if (req.status !== "pending") return fail(c, 409, "already_submitted", "This refund was already sent.");
  if (Math.floor(c.var.now().getTime() / 1000) >= req.validBefore) return fail(c, 400, "expired", "This refund request expired. Start again.");

  const checked = await checkAssertion(c, req.challenge, parsed.data, merchant.id);
  if (!checked) return fail(c, 401, "unauthorized", "The passkey could not be verified.");

  const lock = await db
    .update(refundRequests)
    .set({ status: "sending" })
    .where(and(eq(refundRequests.id, req.id), eq(refundRequests.status, "pending")))
    .returning({ id: refundRequests.id });
  if (lock.length === 0) return fail(c, 409, "already_submitted", "This refund is already being sent.");
  const unlock = () => db.update(refundRequests).set({ status: "pending" }).where(eq(refundRequests.id, req.id));

  try {
    const { r, s } = parseDerSignature(checked.parts.der);
    const signature = encodeWebAuthnSignature({ r, s, authenticatorData: checked.parts.authenticatorData, clientDataJSON: checked.parts.clientDataJSON });
    // A refund a person approved also needs the router's attester signature, over exactly this refund (id, amount, recipient, salt).
    let approval: { deadline: bigint; signature: Hex } | undefined;
    if (req.requiresAttester === 1) {
      if (!c.env.ATTESTER_PRIVATE_KEY) {
        await unlock();
        return fail(c, 503, "approval_unavailable", "Large refunds are not available right now.");
      }
      const deadline = BigInt(Math.floor(c.var.now().getTime() / 1000) + APPROVAL_DEADLINE_SECONDS);
      const signature = await privateKeyToAccount(c.env.ATTESTER_PRIVATE_KEY as Hex).signTypedData({
        domain: routerDomain(c.env.ROUTER_ADDRESS as Address),
        types: refundApprovalTypes,
        primaryType: "RefundApproval",
        message: { opHash: refundOpHash(req.invoiceId as Hex, BigInt(req.value), req.toAddress as Address, req.salt as Hex), deadline },
      });
      approval = { deadline, signature };
    }
    const { txHash } = await chain.refund({
      invoiceId: req.invoiceId as Hex,
      value: BigInt(req.value),
      to: req.toAddress as Address,
      merchant: merchant.address as Address,
      validAfter: 0n,
      validBefore: BigInt(req.validBefore),
      salt: req.salt as Hex,
      signature,
      ...(approval ? { approval } : {}),
    });
    await db.update(refundRequests).set({ status: "submitted", txHash }).where(eq(refundRequests.id, req.id));
    await audit(db, { merchantId: merchant.id, actor: `passkey:${checked.pk.id}`, action: "refund.submitted", payload: { id: req.id, invoiceId: req.invoiceId, to: req.toAddress, value: req.value, txHash } });
    return c.json({ ...view(req), status: "submitted", txHash });
  } catch (e) {
    await unlock();
    if (e instanceof Rejected) {
      const code = e.reason === "RefundTooLarge" ? "refund_too_large" : e.reason === "ApprovalRequired" ? "approval_required" : "refund_rejected";
      return fail(c, code === "approval_required" ? 409 : 422, code, "The refund was rejected: " + e.reason);
    }
    console.error("refund failed", e);
    return fail(c, 502, "chain_error", "The refund could not be sent right now. Try again.");
  }
});
