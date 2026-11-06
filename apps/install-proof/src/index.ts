import { Hono } from "hono";
import { cleanupAuthorized, cleanupInstallInvoices, type InstallEnv } from "./cleanup";

type Env = { Bindings: InstallEnv };
type Order = { id: string; sku: string; name: string; amount: string; status: "pending" | "paid" | "expired"; checkoutKey: string; invoiceId?: string; payUrl?: string };

export const PRODUCTS = [
  { id: "test", name: "Test payment (nothing ships)", price: "1.00" },
  { id: "tee", name: "Studio tee", price: "12.00" },
  { id: "mug", name: "Desk mug", price: "8.50" },
  { id: "print", name: "Poster print", price: "20.00" },
];

const page = (title: string, body: string, head = "") =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${head}
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}li{display:flex;justify-content:space-between;align-items:center;padding:.75rem 0;border-bottom:1px solid #8884}button{font:inherit;padding:.5rem 1rem;cursor:pointer}</style></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

// Keep immutable order data, invoice binding and paid marker in separate keys.
// A late checkout response must never overwrite a webhook's paid marker.
const load = async (kv: KVNamespace, id: string): Promise<Order | null> => {
  const order = await kv.get<Order>(`order:${id}`, "json");
  if (!order) return null;
  const binding = await kv.get<{ invoiceId: string; payUrl: string }>(`invoice:${id}`, "json");
  const paid = await kv.get(`paid:${id}`);
  const retired = await kv.get(`retired:${id}`);
  return { ...order, ...binding, status: paid ? "paid" : retired ? "expired" : "pending" };
};
const save = (kv: KVNamespace, o: Order) => kv.put(`order:${o.id}`, JSON.stringify(o));

/** Base units avoid floating point rounding and reject malformed money fields. */
export function baseUnits(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

async function markPaid(kv: KVNamespace, order: Order): Promise<void> {
  if (order.status !== "paid") await kv.put(`paid:${order.id}`, "true");
}

export const app = new Hono<Env>();

app.get("/", () => {
  const items = PRODUCTS.map((p) => `<li><span>${p.name} · $${p.price}</span><form method="post" action="/buy/${p.id}"><button>Buy</button></form></li>`);
  return page("Studio shop", `<h1>Studio shop</h1><p>A demo store. Nothing here ships.</p><ul>${items.join("")}</ul>`);
});

app.post("/buy/:sku", async (c) => {
  const p = PRODUCTS.find((x) => x.id === c.req.param("sku"));
  if (!p) return c.text("Unknown product", 404);
  const id = crypto.randomUUID().split("-").join("").slice(0, 12);
  await save(c.env.ORDERS, { id, sku: p.id, name: p.name, amount: p.price, status: "pending", checkoutKey: crypto.randomUUID() });
  return c.redirect(`/orders/${id}/pay`, 303);
});

// Only the signed webhook may change payment status.
app.get("/orders/:id/pay", async (c) => {
  const o = await load(c.env.ORDERS, c.req.param("id"));
  if (!o) return c.text("Order not found", 404);
  if (o.status === "expired") return c.text("This payment expired. Start a new order.", 410);
  if (o.status === "paid") return c.redirect(`/orders/${o.id}`, 303);
  return page("Pay", `<h1>Pay $${o.amount}</h1><form method="post" action="/orders/${o.id}/checkout"><button>Pay with Stenmont</button></form>`);
});

app.post("/orders/:id/checkout", async (c) => {
  const o = await load(c.env.ORDERS, c.req.param("id"));
  if (!o) return c.text("Order not found", 404);
  if (o.status === "expired") return c.text("This payment expired. Start a new order.", 410);
  if (o.status === "paid") return c.redirect(`/orders/${o.id}`, 303);
  if (o.invoiceId && o.payUrl) return c.redirect(o.payUrl, 303);
  if (!c.env.STENMONT_API_KEY) return c.text("Payments are temporarily unavailable", 503);
  try {
    const origin = new URL(c.env.SHOP_URL);
    if (origin.protocol !== "https:") return c.text("Payments are temporarily unavailable", 503);
    const response = await fetch("https://api-staging.stenmont.com/v1/invoices", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.STENMONT_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": o.checkoutKey,
      },
      body: JSON.stringify({
        amount: o.amount,
        successUrl: new URL(`/orders/${o.id}`, origin).href,
        cancelUrl: new URL(`/orders/${o.id}/pay`, origin).href,
        metadata: { order: o.id },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json() as { id?: string; payUrl?: string; error?: { code?: string } };
    if (!response.ok) {
      return c.text("Payments are temporarily unavailable", response.status === 403 && result.error?.code === "payments_paused" ? 503 : 502);
    }
    // Only redirect to the documented hosted payment site.
    const payUrl = new URL(result.payUrl ?? "");
    if (typeof result.id !== "string" || !result.id || payUrl.origin !== "https://app-staging.stenmont.com" || !payUrl.pathname.startsWith("/pay/") || payUrl.username || payUrl.password) {
      return c.text("Payments are temporarily unavailable", 502);
    }
    await c.env.ORDERS.put(`invoice:${o.id}`, JSON.stringify({ invoiceId: result.id, payUrl: payUrl.href }));
    return c.redirect(payUrl.href, 303);
  } catch {
    return c.text("Payments are temporarily unavailable", 502);
  }
});

export async function verifySignature(raw: ArrayBuffer, header: string, secret: string): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim());
  const timestamps = parts.filter((part) => part.startsWith("t=")).map((part) => part.slice(2));
  const timestamp = timestamps[0];
  if (timestamps.length !== 1 || !timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + raw.byteLength);
  message.set(prefix);
  message.set(new Uint8Array(raw), prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  for (const signature of parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3))) {
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) continue;
    const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16));
    // Web Crypto performs the MAC comparison; no JavaScript equality comparison.
    valid = (await crypto.subtle.verify("HMAC", key, bytes, message)) || valid;
  }
  return valid;
}

app.post("/webhooks/stenmont", async (c) => {
  if (!c.env.STENMONT_WEBHOOK_SECRET) return c.text("Webhook unavailable", 503);
  const raw = await c.req.raw.arrayBuffer();
  if (!await verifySignature(raw, c.req.header("Stenmont-Signature") ?? "", c.env.STENMONT_WEBHOOK_SECRET)) return c.text("Invalid signature", 400);
  let event: { type?: string; data?: { invoice?: { id?: unknown; amount?: unknown; amountPaid?: unknown; metadata?: { order?: unknown } } } };
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw));
    if (!event || typeof event !== "object" || typeof event.type !== "string") return c.text("Invalid event", 400);
  } catch {
    return c.text("Invalid event", 400);
  }
  if (event.type === "invoice.paid") {
    const invoice = event.data?.invoice;
    const orderId = invoice?.metadata?.order;
    if (typeof orderId !== "string") return c.text("Invalid order", 400);
    const order = await load(c.env.ORDERS, orderId);
    // A webhook can beat the invoice creation response or KV propagation.
    if (!order || !order.invoiceId) return c.text("Order binding not ready; retry", 503);
    const amount = baseUnits(invoice?.amount);
    const amountPaid = baseUnits(invoice?.amountPaid);
    const expected = baseUnits(order.amount);
    if (invoice?.id !== order.invoiceId || expected === null || amount !== expected || amountPaid === null || amountPaid < expected) return c.text("Invoice mismatch", 400);
    await markPaid(c.env.ORDERS, order);
  }
  return c.text("OK", 200);
});

app.get("/orders/:id", async (c) => {
  const o = await load(c.env.ORDERS, c.req.param("id"));
  if (!o) return c.text("Order not found", 404);
  if (o.status === "expired") return c.text("This payment expired. Start a new order.", 410);
  const paid = o.status === "paid";
  const refresh = paid ? "" : `<meta http-equiv="refresh" content="4">`;
  return page("Your order", `<h1 data-testid="status">${paid ? "Paid" : "Waiting for payment"}</h1><p>${o.name} · $${o.amount}</p><p>Order ${o.id}</p>`, refresh);
});

// Operator-only immediate cleanup; scheduled runs use the identical code path.
app.post("/maintenance/cleanup", async (c) => {
  if (!await cleanupAuthorized(c.req.header("authorization"), c.env.STENMONT_API_KEY)) return c.text("Unauthorized", 401);
  const body = await c.req.json<{ invoiceIds?: string[] }>().catch(() => null);
  if (!body || (body.invoiceIds !== undefined && (!Array.isArray(body.invoiceIds) || body.invoiceIds.length > 100 || !body.invoiceIds.every((id) => typeof id === "string")))) return c.text("Invalid request", 400);
  try { return c.json(await cleanupInstallInvoices(c.env, body.invoiceIds)); }
  catch { return c.text("Cleanup unavailable; retained records are safe to retry.", 502); }
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: InstallEnv, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupInstallInvoices(env).then(() => {}));
  },
};
