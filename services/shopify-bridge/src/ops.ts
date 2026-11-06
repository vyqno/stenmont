import { BridgeError } from "./util";
import { checkUserErrors, toGid, type Shopify } from "./shopify";

export type Draft = { id: string; name: string; status: string; total: string; currency: string; orderId: string | null; lines: number };

const Q_DRAFT = `query Draft($id: ID!) { draftOrder(id: $id) { id name status totalPriceSet { shopMoney { amount currencyCode } } order { id } lineItems(first: 1) { nodes { id } } } }`;
const M_DRAFT_CREATE = `mutation DraftCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }`;
const M_INVOICE_SEND = `mutation Send($id: ID!, $email: EmailInput) { draftOrderInvoiceSend(id: $id, email: $email) { draftOrder { id } userErrors { field message } } }`;

/** Reads a draft order from Shopify. This is the ONLY source of a price: nothing the browser sends is ever used for money. */
export async function getDraft(s: Shopify, id: string): Promise<Draft> {
  const d = (await s.gql<{ draftOrder: any }>(Q_DRAFT, { id })).draftOrder;
  if (!d) throw new BridgeError(404, "draft_not_found", "No draft order with that id.");
  const money = d.totalPriceSet?.shopMoney;
  return { id: d.id, name: String(d.name ?? ""), status: String(d.status ?? ""), total: String(money?.amount ?? ""), currency: String(money?.currencyCode ?? ""), orderId: d.order?.id ?? null, lines: d.lineItems?.nodes?.length ?? 0 };
}

export type CartLine = { variantId: string; quantity: number };

/** Turns cart lines (variant ids and quantities only; no prices) into a Shopify draft order and returns its global id. */
export async function createDraft(s: Shopify, lines: CartLine[]): Promise<string> {
  const input = { lineItems: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), tags: ["stenmont"] };
  const p = (await s.gql<any>(M_DRAFT_CREATE, { input })).draftOrderCreate;
  checkUserErrors(p);
  const id = p.draftOrder?.id;
  if (typeof id !== "string") throw new BridgeError(502, "shopify_bad_response", "Shopify did not return the draft order.");
  return id;
}

export async function sendDraftInvoice(s: Shopify, id: string, customMessage: string): Promise<void> {
  checkUserErrors((await s.gql<any>(M_INVOICE_SEND, { id, email: { customMessage } })).draftOrderInvoiceSend);
}

/** Validates the public `cartLines` input: variant ids and whole quantities only. */
export function parseCartLines(v: unknown): CartLine[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 50) throw new BridgeError(422, "bad_cart", "cartLines must have 1 to 50 lines.");
  return v.map((l) => {
    const q = (l as any)?.quantity;
    if (!Number.isInteger(q) || q < 1 || q > 100) throw new BridgeError(422, "bad_cart", "Each quantity must be a whole number from 1 to 100.");
    return { variantId: toGid("ProductVariant", (l as any)?.variantId), quantity: q };
  });
}

export const USDT_METHOD = "Pay with USDT (Stenmont)";
export type Order = { id: string; name: string; note: string; tags: string[]; status: string; total: string; currency: string };

const Q_ORDER = `query Order($id: ID!) { order(id: $id) { id name note tags displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } } }`;
const M_COMPLETE = `mutation Complete($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { id order { id } } userErrors { field message } } }`;
const M_MANUAL = `mutation Manual($id: ID!, $name: String) { orderCreateManualPayment(id: $id, paymentMethodName: $name) { order { id } userErrors { field message } } }`;
const M_MARK_PAID = `mutation Paid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id } userErrors { field message } } }`;
const M_TAGS = `mutation Tags($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;
const M_NOTE = `mutation Note($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`;

export async function getOrder(s: Shopify, id: string): Promise<Order> {
  const o = (await s.gql<{ order: any }>(Q_ORDER, { id })).order;
  if (!o) throw new BridgeError(404, "order_not_found", "No order with that id.");
  const m = o.totalPriceSet?.shopMoney;
  return { id: o.id, name: String(o.name ?? ""), note: String(o.note ?? ""), tags: Array.isArray(o.tags) ? o.tags : [], status: String(o.displayFinancialStatus ?? ""), total: String(m?.amount ?? ""), currency: String(m?.currencyCode ?? "") };
}

/** Completes a draft order as an order whose payment is still pending, and returns the new order's id. */
export async function completeDraft(s: Shopify, id: string): Promise<string> {
  const p = (await s.gql<any>(M_COMPLETE, { id })).draftOrderComplete;
  checkUserErrors(p);
  const order = p.draftOrder?.order?.id;
  if (typeof order !== "string") throw new BridgeError(502, "shopify_bad_response", "Shopify did not return the order.");
  return order;
}

/**
 * Records the payment against the order under the method name "Pay with USDT (Stenmont)". If Shopify refuses the named manual
 * payment, it falls back to "mark as paid". Either way the order must end up PAID or this throws, so the webhook is retried.
 */
export async function recordPayment(s: Shopify, order: Order): Promise<void> {
  if (order.status === "PAID") return;
  try {
    checkUserErrors((await s.gql<any>(M_MANUAL, { id: order.id, name: USDT_METHOD })).orderCreateManualPayment);
  } catch (e) {
    if (!(e instanceof BridgeError) || e.code !== "shopify_rejected") throw e;
    checkUserErrors((await s.gql<any>(M_MARK_PAID, { input: { id: order.id } })).orderMarkAsPaid);
  }
  if ((await getOrder(s, order.id)).status !== "PAID") throw new BridgeError(502, "payment_not_recorded", "Shopify did not mark the order as paid.");
}

export async function addTags(s: Shopify, id: string, tags: string[]): Promise<void> {
  checkUserErrors((await s.gql<any>(M_TAGS, { id, tags })).tagsAdd);
}

/** Appends a line to the order note (orderUpdate replaces the note, so the old text is read and kept). Skips if `marker` is already in it. */
export async function appendNote(s: Shopify, order: Order, line: string, marker: string): Promise<void> {
  if (order.note.includes(marker)) return;
  const note = order.note ? `${order.note}\n${line}` : line;
  if (note.length > 5000) return; // Shopify's note limit; the tag still tells the story
  checkUserErrors((await s.gql<any>(M_NOTE, { input: { id: order.id, note } })).orderUpdate);
}

export const WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_PAID"] as const;
const Q_SUBS = `query Subs($uri: String!) { webhookSubscriptions(first: 50, uri: $uri) { nodes { id topic uri } } }`;
const M_SUB = `mutation Sub($topic: WebhookSubscriptionTopic!, $uri: String!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri }) { webhookSubscription { id } userErrors { field message } } }`;

/** Lists the shop's subscriptions for this address first, and only creates the ones that are missing. */
export async function registerWebhooks(s: Shopify, uri: string): Promise<{ created: string[]; existing: string[] }> {
  const have = new Set<string>(((await s.gql<any>(Q_SUBS, { uri })).webhookSubscriptions?.nodes ?? []).filter((n: any) => n?.uri === uri).map((n: any) => String(n.topic)));
  const out = { created: [] as string[], existing: [] as string[] };
  for (const topic of WEBHOOK_TOPICS) {
    if (have.has(topic)) {
      out.existing.push(topic);
      continue;
    }
    checkUserErrors((await s.gql<any>(M_SUB, { topic, uri })).webhookSubscriptionCreate);
    out.created.push(topic);
  }
  return out;
}
