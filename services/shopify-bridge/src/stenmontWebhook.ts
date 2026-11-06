import { verifyWebhook } from "@stenmont/sdk";
import type { Bindings, Deps } from "./env";
import { shopifyFor } from "./invoices";
import { parseUnits6, toUsdtAmount } from "./money";
import { addTags, appendNote, completeDraft, getDraft, getOrder, recordPayment } from "./ops";
import { numericId, toGid, type Shopify } from "./shopify";
import { BridgeError } from "./util";

export const EXPLORER = "https://explorer.testnet.whitechain.io";
const explorerTx = (h: unknown) => (typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h) ? `${EXPLORER}/tx/${h}` : null);

type Paid = { orderId: string; invoiceId: string; txHash: string | null; at: string };
export type Result = { status: "done" | "already_done" | "ignored" | "needs_review"; reason?: string };

type StenmontInvoice = { id?: string; amount?: string; metadata?: Record<string, string> };
type StenmontEvent = { id: string; type: string; data: { invoice?: StenmontInvoice; payment?: { txHash?: string }; refund?: { to?: string; value?: string; txHash?: string } } };

/** Handles one verified Stenmont event. Every step is safe to repeat, so a failed delivery can simply be retried. */
export async function handleStenmontEvent(env: Bindings, deps: Deps, event: StenmontEvent): Promise<Result> {
  const inv = event.data?.invoice;
  const meta = inv?.metadata ?? {};
  if (!inv?.id || meta.shop !== env.SHOPIFY_SHOP_DOMAIN) return { status: "ignored", reason: "not_ours" };
  if (event.type === "invoice.paid") return handlePaid(env, shopifyFor(env, deps), event, inv, meta);
  if (event.type === "refund.created" || event.type === "invoice.refunded") return handleRefund(env, shopifyFor(env, deps), event, inv, meta);
  return { status: "ignored", reason: "type" };
}

async function handlePaid(env: Bindings, s: Shopify, event: StenmontEvent, inv: StenmontInvoice, meta: Record<string, string>): Promise<Result> {
  const draftGid = meta.draftOrderId ? toGid("DraftOrder", meta.draftOrderId) : null;
  const orderGidFromMeta = meta.orderId ? toGid("Order", meta.orderId) : null;
  const subject = draftGid ?? orderGidFromMeta;
  if (!subject) return { status: "ignored", reason: "no_reference" };
  const paidKey = `paid:${numericId(subject)}`;
  if (await env.STATE.get(paidKey)) return { status: "already_done" };
  const review = async (reason: string): Promise<Result> => {
    await env.STATE.put(`review:${numericId(subject)}`, JSON.stringify({ reason, invoiceId: inv.id, at: new Date().toISOString() }));
    return { status: "needs_review", reason };
  };

  let orderGid: string;
  if (draftGid) {
    const draft = await getDraft(s, draftGid);
    const marker = await env.STATE.get(`completing:${numericId(draftGid)}`);
    if (draft.status === "COMPLETED" || draft.orderId) {
      // Only carry on if it was this bridge that completed it (a retry after a half-finished run); never touch someone else's order.
      if (!draft.orderId || marker !== draft.orderId) return review("draft_completed_elsewhere");
      orderGid = draft.orderId;
    } else {
      // The price is re-read from Shopify and must still match what was invoiced.
      let expected: string;
      try {
        expected = toUsdtAmount(draft.total, draft.currency, env.RATE_PER_USD);
      } catch {
        return review("price_not_convertible");
      }
      if (parseUnits6(inv.amount ?? "") !== parseUnits6(expected)) return review("price_changed");
      orderGid = await completeDraft(s, draftGid);
      await env.STATE.put(`completing:${numericId(draftGid)}`, orderGid);
      await env.STATE.put(`fromdraft:${numericId(orderGid)}`, numericId(draftGid)); // so the order mirror never invoices this order a second time
    }
  } else {
    orderGid = orderGidFromMeta!;
  }

  let order = await getOrder(s, orderGid);
  if (!draftGid) {
    // Orders can be edited after invoicing, just like drafts. Never mark a changed order paid by the old invoice.
    if (meta.shopifyCurrency && order.currency !== meta.shopifyCurrency) return review("price_changed");
    let expected: string;
    try {
      expected = toUsdtAmount(order.total, order.currency, env.RATE_PER_USD);
    } catch {
      return review("price_not_convertible");
    }
    if (parseUnits6(inv.amount ?? "") !== parseUnits6(expected)) return review("price_changed");
  }
  if (order.status === "VOIDED" || order.status === "REFUNDED") return review(`order_${order.status.toLowerCase()}`);
  await recordPayment(s, order);
  order = await getOrder(s, orderGid);
  const tx = explorerTx(event.data.payment?.txHash);
  await addTags(s, orderGid, ["stenmont", "stenmont-paid"]);
  await appendNote(s, order, `Paid with USDT via Stenmont. Invoice ${inv.id}.${tx ? ` Transaction: ${tx}` : ""}`, `Invoice ${inv.id}.`);
  const done: Paid = { orderId: orderGid, invoiceId: inv.id!, txHash: event.data.payment?.txHash ?? null, at: new Date().toISOString() };
  await env.STATE.put(paidKey, JSON.stringify(done));
  return { status: "done" };
}

/** A refund only leaves a tag and a note. Refunding in Shopify is the merchant's decision. */
async function handleRefund(env: Bindings, s: Shopify, event: StenmontEvent, inv: StenmontInvoice, meta: Record<string, string>): Promise<Result> {
  let orderGid: string | null = meta.orderId ? toGid("Order", meta.orderId) : null;
  if (!orderGid && meta.draftOrderId) orderGid = (await env.STATE.get<Paid>(`paid:${numericId(toGid("DraftOrder", meta.draftOrderId))}`, "json"))?.orderId ?? null;
  if (!orderGid) return { status: "ignored", reason: "no_order" };
  const r = event.data.refund ?? {};
  const tx = explorerTx(r.txHash);
  const order = await getOrder(s, orderGid);
  await addTags(s, orderGid, ["stenmont", "stenmont-refunded"]);
  await appendNote(s, order, `Stenmont refund of ${String(r.value ?? "?").slice(0, 20)} USDT on invoice ${inv.id}.${tx ? ` Transaction: ${tx}` : ""} Refund the order in Shopify if you want it reflected there.`, tx ?? `refund:${event.id}`);
  return { status: "done" };
}

/** Verifies the Stenmont signature and the event, then handles it once. */
export async function receiveStenmont(env: Bindings, deps: Deps, raw: string, signature: string | undefined): Promise<Result> {
  if (!env.STENMONT_WEBHOOK_SECRET) throw new BridgeError(500, "misconfigured", "STENMONT_WEBHOOK_SECRET is not set.");
  let event: StenmontEvent;
  try {
    event = (await verifyWebhook(raw, signature ?? "", env.STENMONT_WEBHOOK_SECRET)) as unknown as StenmontEvent;
  } catch {
    throw new BridgeError(401, "bad_signature", "The webhook signature is not valid.");
  }
  if (typeof event.id !== "string") throw new BridgeError(400, "bad_event", "The event has no id.");
  if (await env.STATE.get(`evt:${event.id}`)) return { status: "already_done", reason: "duplicate_event" };
  const result = await handleStenmontEvent(env, deps, event);
  await env.STATE.put(`evt:${event.id}`, "1", { expirationTtl: 60 * 60 * 24 * 14 });
  return result;
}
