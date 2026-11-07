# Adding Stenmont to a store

The example store started as a plain cart with a fake Pay button (commit `feat(example-store): add baseline store with a stand-in checkout`). Adding Stenmont changed `src/index.ts` by **10 added lines** (the fake checkout it replaced was deleted), plus one dependency line. The prices were also lowered for the test faucet; that is a shop setting, not part of the integration.

```diff
+import { Stenmont, verifyWebhook } from "@vyqno/sdk";
-type Env = { Bindings: { ORDERS: KVNamespace; SHOP_URL: string } };
+type Env = { Bindings: { ORDERS: KVNamespace; SHOP_URL: string; STENMONT_API_KEY: string; STENMONT_API_URL: string; STENMONT_WEBHOOK_SECRET: string } };
-  return c.redirect(`/orders/${id}/pay`, 303); // a stand-in checkout; the real one replaces this
+  const stenmont = new Stenmont({ apiKey: c.env.STENMONT_API_KEY, baseUrl: c.env.STENMONT_API_URL });
+  const session = await stenmont.checkout.sessions.create({ amount: p.price, successUrl: `${c.env.SHOP_URL}/orders/${id}`, cancelUrl: c.env.SHOP_URL, metadata: { order: id } }).catch(() => null);
+  return session ? c.redirect(session.url, 303) : c.text("Checkout is unavailable. Please try again.", 502);
-// The fake checkout every tutorial starts with: a button that just says "paid".
-app.get("/orders/:id/pay", async (c) => {
-  const o = await load(c.env.ORDERS, c.req.param("id"));
-  if (!o) return c.text("Order not found", 404);
-  return page("Pay", `<h1>Pay $${o.amount}</h1><form method="post" action="/orders/${o.id}/fake-pay"><button>Pay</button></form>`);
-});
-app.post("/orders/:id/fake-pay", async (c) => {
-  await markPaid(c.env.ORDERS, c.req.param("id"));
-  return c.redirect(`/orders/${c.req.param("id")}`, 303);
+app.post("/webhooks/stenmont", async (c) => {
+  const event = await verifyWebhook<{ invoice: { metadata: { order?: string } } }>(await c.req.text(), c.req.header("stenmont-signature") ?? "", c.env.STENMONT_WEBHOOK_SECRET).catch(() => null);
+  if (!event) return c.text("Bad signature", 400);
+  if (event.type === "invoice.paid") await markPaid(c.env.ORDERS, event.data.invoice.metadata.order);
+  return c.text("ok");
```

What each part does:

1. `Stenmont(...).checkout.sessions.create(...)` makes a checkout for the order. The shopper is sent to the Stenmont pay page, pays with a passkey (no wallet, no gas), and is sent back to `successUrl`.
2. `metadata: { order: id }` travels with the payment, so the webhook says which order was paid.
3. `/webhooks/stenmont` checks the signature with `verifyWebhook` (a wrong secret, a changed body or an old timestamp is refused) and marks the order paid. `markPaid` can be called twice safely, because a webhook can be delivered more than once.

Setup: two secrets, `STENMONT_API_KEY` and `STENMONT_WEBHOOK_SECRET` (`wrangler secret put`), and two plain settings, `SHOP_URL` and `STENMONT_API_URL`.

Live on staging: https://shop-staging.stenmont.com (test funds only). The demo products cost under $5 because the test-environment faucet gives each new shopper 5 test USDT.
