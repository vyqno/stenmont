import { Stenmont, StenmontError } from "@stenmont/sdk";
import type { Bindings, Deps } from "./env";
import { toUsdtAmount } from "./money";
import { getDraft, type Draft } from "./ops";
import { makeShopify, numericId, type Shopify } from "./shopify";
import { tokenProvider } from "./token";
import { BridgeError } from "./util";

export type InvoiceRecord = { invoiceId: string; payUrl: string; amount: string; draftOrderId: string };

/** Checks everything the bridge needs is set. Messages name the variable, never its value. */
export function shopifyFor(env: Bindings, deps: Deps): Shopify {
  return makeShopify({ shop: env.SHOPIFY_SHOP_DOMAIN, token: tokenProvider(env, deps), fetch: deps.fetch, sleep: deps.sleep });
}

export function stenmontFor(env: Bindings, deps: Deps): Stenmont {
  if (!env.STENMONT_API_KEY || !env.STENMONT_API_URL) throw new BridgeError(500, "misconfigured", "STENMONT_API_KEY and STENMONT_API_URL must be set.");
  return new Stenmont({ apiKey: env.STENMONT_API_KEY, baseUrl: env.STENMONT_API_URL, fetch: deps.fetch });
}

export function shopUrl(env: Bindings): string {
  try {
    const u = new URL(env.SHOP_URL);
    if (u.protocol === "https:") return u.origin;
  } catch {}
  throw new BridgeError(500, "misconfigured", "SHOP_URL must be an https address.");
}

/**
 * Creates (or finds) the Stenmont invoice for a draft order. The price comes from the draft read just now from Shopify and is
 * converted here. The same draft at the same price always gives the same invoice (KV, and the Stenmont idempotency key);
 * if the merchant edits the draft's price, a new invoice is made.
 * ponytail: KV is not atomic; two simultaneous first calls both reach Stenmont, whose idempotency key makes them return one invoice.
 */
export async function invoiceForDraft(env: Bindings, deps: Deps, shopify: Shopify, draftGid: string): Promise<{ record: InvoiceRecord; draft: Draft }> {
  const draft = await getDraft(shopify, draftGid);
  if (draft.status === "COMPLETED" || draft.orderId) throw new BridgeError(409, "already_completed", "This draft order is already completed.");
  if (draft.lines < 1) throw new BridgeError(422, "empty_draft", "The draft order has no items.");
  const amount = toUsdtAmount(draft.total, draft.currency, env.RATE_PER_USD);
  const base = shopUrl(env);
  const n = numericId(draft.id);
  const key = `inv:${n}:${amount}`;
  const cached = await env.STATE.get<InvoiceRecord>(key, "json");
  if (cached) return { record: cached, draft };

  let session: { id: string; url: string };
  try {
    session = await stenmontFor(env, deps).checkout.sessions.create(
      {
        amount,
        successUrl: `${base}/?stenmont=paid&draft=${n}`,
        cancelUrl: `${base}/cart`,
        metadata: {
          shop: env.SHOPIFY_SHOP_DOMAIN,
          draftOrderId: draft.id,
          shopifyTotal: draft.total,
          shopifyCurrency: draft.currency,
          rate: draft.currency === "USD" ? "1" : String(env.RATE_PER_USD).trim(),
        },
      },
      { idempotencyKey: `shopify-bridge:${env.SHOPIFY_SHOP_DOMAIN}:${n}:${amount}` },
    );
  } catch (e) {
    if (e instanceof BridgeError) throw e;
    throw new BridgeError(502, "stenmont_error", e instanceof StenmontError ? `Stenmont refused the invoice (${e.code}).` : "Could not reach Stenmont.");
  }
  const record: InvoiceRecord = { invoiceId: session.id, payUrl: session.url, amount, draftOrderId: draft.id };
  await env.STATE.put(key, JSON.stringify(record));
  await env.STATE.put(`draft:${n}`, JSON.stringify(record)); // latest invoice for this draft
  return { record, draft };
}
