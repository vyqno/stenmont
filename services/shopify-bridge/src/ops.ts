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
