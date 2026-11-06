import { Stenmont, verifyWebhook } from "@stenmont/sdk";
import { Hono } from "hono";

type Env = { Bindings: { ORDERS: KVNamespace; SHOP_URL: string; STENMONT_API_KEY: string; STENMONT_API_URL: string; STENMONT_WEBHOOK_SECRET: string } };
type Order = { id: string; sku: string; name: string; amount: string; status: "pending" | "paid" };

export const PRODUCTS = [
  { id: "tee", name: "Studio tee", price: "2.00" },
  { id: "mug", name: "Desk mug", price: "1.50" },
  { id: "print", name: "Poster print", price: "4.00" },
];

const page = (title: string, body: string, head = "") =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${head}
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}li{display:flex;justify-content:space-between;align-items:center;padding:.75rem 0;border-bottom:1px solid #8884}button{font:inherit;padding:.5rem 1rem;cursor:pointer}</style></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

const load = async (kv: KVNamespace, id: string) => (await kv.get<Order>(`order:${id}`, "json")) ?? null;
const save = (kv: KVNamespace, o: Order) => kv.put(`order:${o.id}`, JSON.stringify(o));

/** Marks an order paid. Safe to call twice (a webhook can be delivered more than once). */
export async function markPaid(kv: KVNamespace, id: string | undefined): Promise<boolean> {
  const order = id ? await load(kv, id) : null;
  if (!order) return false;
  if (order.status !== "paid") await save(kv, { ...order, status: "paid" });
  return true;
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
  await save(c.env.ORDERS, { id, sku: p.id, name: p.name, amount: p.price, status: "pending" });
  const stenmont = new Stenmont({ apiKey: c.env.STENMONT_API_KEY, baseUrl: c.env.STENMONT_API_URL });
  const session = await stenmont.checkout.sessions.create({ amount: p.price, successUrl: `${c.env.SHOP_URL}/orders/${id}`, cancelUrl: c.env.SHOP_URL, metadata: { order: id } }).catch(() => null);
  return session ? c.redirect(session.url, 303) : c.text("Checkout is unavailable. Please try again.", 502);
});

app.post("/webhooks/stenmont", async (c) => {
  const event = await verifyWebhook<{ invoice: { metadata: { order?: string } } }>(await c.req.text(), c.req.header("stenmont-signature") ?? "", c.env.STENMONT_WEBHOOK_SECRET).catch(() => null);
  if (!event) return c.text("Bad signature", 400);
  if (event.type === "invoice.paid") await markPaid(c.env.ORDERS, event.data.invoice.metadata.order);
  return c.text("ok");
});

app.get("/orders/:id", async (c) => {
  const o = await load(c.env.ORDERS, c.req.param("id"));
  if (!o) return c.text("Order not found", 404);
  const paid = o.status === "paid";
  const refresh = paid ? "" : `<meta http-equiv="refresh" content="4">`;
  return page("Your order", `<h1 data-testid="status">${paid ? "Paid" : "Waiting for payment"}</h1><p>${o.name} · $${o.amount}</p><p>Order ${o.id}</p>`, refresh);
});

export default app;
