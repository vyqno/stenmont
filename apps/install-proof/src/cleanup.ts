export type InstallEnv = { ORDERS: KVNamespace; SHOP_URL: string; STENMONT_API_KEY: string; STENMONT_WEBHOOK_SECRET: string };
type Candidate = { id: string; status: string; amountPaid: string; metadata?: { order?: string }; successUrl?: string | null };
type CleanupResult = { id: string; status: string; changed: boolean; creationReleased: boolean };
const API = "https://api-staging.stenmont.com";

/** Retain invoices/receipts; retire hosted checkout through the authenticated API policy. */
export async function cleanupInstallInvoices(env: InstallEnv, ids?: string[], fetcher: typeof fetch = fetch) {
  if (new URL(env.SHOP_URL).hostname !== "install-proof-staging.stenmont.com" || !env.STENMONT_API_KEY) throw new Error("Cleanup unavailable");
  const headers = { authorization: `Bearer ${env.STENMONT_API_KEY}`, "content-type": "application/json" };
  const list = await fetcher(`${API}/v1/invoices?limit=100`, { headers, signal: AbortSignal.timeout(10000) });
  if (!list.ok) throw new Error("Cleanup unavailable");
  const { data } = await list.json() as { data: Candidate[] };
  const changed: CleanupResult[] = [];
  const reconciled: CleanupResult[] = [];
  for (const invoice of data) {
    if (ids && !ids.includes(invoice.id)) continue;
    if (!["open", "creating", "expired", "failed"].includes(invoice.status) || invoice.amountPaid !== "0") continue;
    const orderId = invoice.metadata?.order;
    if (typeof orderId !== "string" || !invoice.successUrl || !URL.canParse(invoice.successUrl) || new URL(invoice.successUrl).origin !== new URL(env.SHOP_URL).origin) continue;
    if (await env.ORDERS.get(`paid:${orderId}`)) continue;
    let result: CleanupResult;
    if (["expired", "failed"].includes(invoice.status)) {
      // The server may already have committed before a response or local write failed.
      result = { id: invoice.id, status: invoice.status, changed: false, creationReleased: false };
    } else {
      const order = await env.ORDERS.get<{ checkoutKey?: string; amount?: string }>(`order:${orderId}`, "json");
      if (invoice.status === "creating" && (!order?.checkoutKey || !order.amount)) continue;
      const response = await fetcher(`${API}/v1/invoices/${encodeURIComponent(invoice.id)}/expire-install`, {
        method: "POST", headers,
        body: JSON.stringify(invoice.status === "creating" ? {
          creationKey: order!.checkoutKey,
          creationRequest: {
            amount: order!.amount,
            successUrl: new URL(`/orders/${orderId}`, env.SHOP_URL).href,
            cancelUrl: new URL(`/orders/${orderId}/pay`, env.SHOP_URL).href,
            metadata: { order: orderId },
          },
        } : {}),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Cleanup unavailable");
      result = await response.json() as CleanupResult;
    }
    if (result.id !== invoice.id || !["expired", "failed"].includes(result.status)) continue;
    // A signed payment received during the API request still takes precedence.
    if (await env.ORDERS.get(`paid:${orderId}`)) continue;
    // Retain the order, binding, and original audit for late signed webhooks.
    const retired = await env.ORDERS.get(`retired:${orderId}`);
    const audit = await env.ORDERS.get<CleanupResult>(`cleanup:${invoice.id}`, "json");
    const needsRetirement = !retired;
    const needsAudit = audit?.id !== result.id || audit?.status !== result.status;
    if (needsRetirement) await env.ORDERS.put(`retired:${orderId}`, result.status);
    if (needsAudit) await env.ORDERS.put(`cleanup:${invoice.id}`, JSON.stringify(result));
    if (result.changed) changed.push(result);
    else if (needsRetirement || needsAudit) reconciled.push(result);
  }
  return { changed, reconciled };
}

export async function cleanupAuthorized(provided: string | undefined, expected: string): Promise<boolean> {
  if (!provided?.startsWith("Bearer ") || !expected) return false;
  const encode = (s: string) => new TextEncoder().encode(s);
  const [a, b] = await Promise.all([provided.slice(7), expected].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encode(value)))));
  let mismatch = 0;
  for (let i = 0; i < 32; i++) mismatch |= a![i]! ^ b![i]!;
  return mismatch === 0;
}
