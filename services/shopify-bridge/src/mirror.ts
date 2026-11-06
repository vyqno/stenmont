import type { Bindings, Deps } from "./env";
import { stenmontFor, shopUrl } from "./invoices";
import { toUsdtAmount } from "./money";
import { getOrder, USDT_METHOD } from "./ops";
import { numericId, toGid, type Shopify } from "./shopify";
import { BridgeError } from "./util";

/** What the "what is happening in the store" feed shows about one order. No customer name, email, address or phone is ever kept. */
export type Mirror = {
  id: string;
  name: string;
  total: string;
  currency: string;
  gateways: string[];
  status: string;
  createdAt: string | null;
  paidAt: string | null;
  updatedAt: string;
  stenmont?: { invoiceId: string; payUrl: string };
  invoiceError?: string;
};

// Later states win, so an old "pending" arriving after "paid" cannot move an order backwards.
const RANK: Record<string, number> = { pending: 0, authorized: 1, partially_paid: 1, paid: 2, partially_refunded: 3, refunded: 4, voided: 5 };
const rank = (s: string) => RANK[s] ?? 0;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "");
const isoOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export const TOPICS = ["orders/create", "orders/paid"] as const;

/** Reads the few fields we keep out of a Shopify order webhook body. */
export function readOrderPayload(p: any): { gid: string; name: string; total: string; currency: string; gateways: string[]; status: string; createdAt: string | null } {
  const gid = typeof p?.admin_graphql_api_id === "string" ? toGid("Order", p.admin_graphql_api_id) : toGid("Order", p?.id);
  const total = text(p?.total_price, 30);
  return {
    gid,
    name: text(p?.name, 40),
    total: /^\d{1,15}(\.\d{1,6})?$/.test(total) ? total : "",
    currency: /^[A-Z]{3}$/.test(String(p?.currency)) ? String(p.currency) : "",
    gateways: Array.isArray(p?.payment_gateway_names) ? p.payment_gateway_names.slice(0, 10).map((g: unknown) => text(g, 80)).filter(Boolean) : [],
    status: text(p?.financial_status, 30).toLowerCase(),
    createdAt: isoOrNull(p?.created_at),
  };
}

/** Merges one webhook into the stored mirror. Safe for replays and for events that arrive out of order. */
export async function recordOrder(env: Bindings, deps: Deps, topic: string, payload: unknown, shopify: () => Shopify): Promise<Mirror> {
  const o = readOrderPayload(payload);
  const key = `order:${numericId(o.gid)}`;
  const old = await env.STATE.get<Mirror>(key, "json");
  const incoming = topic === "orders/paid" && rank(o.status) < 2 ? "paid" : o.status; // orders/paid means paid even if the body lags
  const status = old && rank(old.status) > rank(incoming) ? old.status : incoming || old?.status || "pending";
  const m: Mirror = {
    id: numericId(o.gid),
    name: o.name || old?.name || "",
    total: o.total || old?.total || "",
    currency: o.currency || old?.currency || "",
    gateways: [...new Set([...(old?.gateways ?? []), ...o.gateways])],
    status,
    createdAt: old?.createdAt ?? o.createdAt,
    paidAt: old?.paidAt ?? (rank(status) >= 2 ? new Date(deps.now()).toISOString() : null),
    updatedAt: new Date(deps.now()).toISOString(),
    ...(old?.stenmont ? { stenmont: old.stenmont } : {}),
    ...(old?.invoiceError ? { invoiceError: old.invoiceError } : {}),
  };

  // A customer chose the manual payment "Pay with USDT (Stenmont)" at Shopify checkout: make the invoice for it.
  const wantsUsdt = m.gateways.some((g) => g.toLowerCase() === USDT_METHOD.toLowerCase());
  if (wantsUsdt && rank(m.status) < 2 && !m.stenmont && !(await env.STATE.get(`fromdraft:${m.id}`))) {
    try {
      const made = await invoiceForOrder(env, deps, shopify(), o.gid);
      m.stenmont = made;
      delete m.invoiceError;
    } catch (e) {
      // Answer Shopify 200 anyway: repeated failures would make Shopify delete our webhook subscription.
      m.invoiceError = e instanceof BridgeError ? e.code : "unknown";
    }
  }
  await env.STATE.put(key, JSON.stringify(m));
  return m;
}

/** The price is read from Shopify again, server-side, even though the webhook body carried a total. */
async function invoiceForOrder(env: Bindings, deps: Deps, shopify: Shopify, orderGid: string): Promise<{ invoiceId: string; payUrl: string }> {
  const order = await getOrder(shopify, orderGid);
  const amount = toUsdtAmount(order.total, order.currency, env.RATE_PER_USD);
  const base = shopUrl(env);
  let session: { id: string; url: string };
  try {
    session = await stenmontFor(env, deps).checkout.sessions.create(
      {
        amount,
        successUrl: `${base}/?stenmont=paid&order=${numericId(orderGid)}`,
        cancelUrl: base,
        metadata: { shop: env.SHOPIFY_SHOP_DOMAIN, orderId: orderGid, shopifyTotal: order.total, shopifyCurrency: order.currency, rate: order.currency === "USD" ? "1" : String(env.RATE_PER_USD).trim() },
      },
      { idempotencyKey: `shopify-bridge:${env.SHOPIFY_SHOP_DOMAIN}:order:${numericId(orderGid)}:${amount}` },
    );
  } catch {
    throw new BridgeError(502, "stenmont_error", "Could not create the Stenmont invoice.");
  }
  return { invoiceId: session.id, payUrl: session.url };
}

export async function listFeed(env: Bindings, limit: number, cursor?: string) {
  const page = await env.STATE.list({ prefix: "order:", limit, ...(cursor ? { cursor } : {}) });
  const orders = (await Promise.all(page.keys.map((k) => env.STATE.get<Mirror>(k.name, "json")))).filter((m): m is Mirror => !!m);
  orders.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const reviewKeys = await env.STATE.list({ prefix: "review:", limit: 50 });
  const reviews = await Promise.all(reviewKeys.keys.map(async (k) => ({ ref: k.name.slice(7), ...(await env.STATE.get<object>(k.name, "json")) })));
  return { orders, reviews, ...(page.list_complete ? {} : { cursor: (page as { cursor?: string }).cursor }) };
}
