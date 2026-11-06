# Shopify bridge: keep your Shopify store, take payments with Stenmont

`services/shopify-bridge` is a separate Cloudflare Worker. Shopify keeps running the store (catalogue, cart, shipping, orders). The bridge
turns a Shopify draft order into a Stenmont invoice, sends the customer to the Stenmont pay page, and when the payment lands it completes the
order in Shopify and records the payment as the manual method **Pay with USDT (Stenmont)**. It also keeps a small mirror of orders so a
dashboard can show what is happening in the store.

Status: built and unit-tested locally (70 tests) with an injected `fetch` (no real Shopify or Stenmont call has been made). Not deployed.

## How it works

```
cart page --(variant ids + quantities)--> POST /checkout --> draftOrderCreate (Shopify)
                                                         --> read total from Shopify, convert to USDT
                                                         --> Stenmont checkout session (idempotent per draft + price)
          <--------------------- { payUrl } ------------- customer pays on the Stenmont page
Stenmont --invoice.paid--> POST /webhooks/stenmont --> re-read the draft, check the price still matches
                                                   --> draftOrderComplete (payment pending)
                                                   --> orderCreateManualPayment "Pay with USDT (Stenmont)" (fallback: orderMarkAsPaid)
                                                   --> tag + order note with the invoice id and explorer link
Shopify --orders/create, orders/paid--> POST /webhooks/shopify --> order mirror in KV (no personal data)
                                                              --> invoice for orders placed with the USDT manual method
```

## Routes

| Route | Auth | What it does |
|---|---|---|
| `POST /checkout` | none (CORS: `ALLOWED_ORIGINS` only, 20 requests a minute per caller) | `{draftOrderId}` or `{cartLines:[{variantId,quantity}]}` returns `{payUrl, invoiceId, draftOrderId}` |
| `POST /invoice-send` | `Bearer BRIDGE_ADMIN_TOKEN` (10 a minute) | `{draftOrderId, message?}` creates the invoice and has Shopify email its invoice with the pay link in the message |
| `POST /webhooks/stenmont` | Stenmont signature (`verifyWebhook`) | `invoice.paid` completes the order; `refund.created` adds a tag and a note |
| `POST /webhooks/shopify` | Shopify HMAC over the raw body | `orders/create`, `orders/paid` update the mirror |
| `GET /orders` | `Bearer BRIDGE_ADMIN_TOKEN` | the mirror (newest first) plus any `reviews` (payments that need a person) |
| `POST /admin/register-webhooks` | `Bearer BRIDGE_ADMIN_TOKEN` | creates the two Shopify subscriptions (lists first, so repeating it creates nothing) and prints what it did |
| `GET /health` | none | `{ok:true}` |

## Money

- The price is **only ever read from Shopify on the server** (`draftOrder.totalPriceSet.shopMoney`). The browser sends ids and quantities, never an amount.
- Shop currency USD: 1 USD = 1 USDT. Any other currency needs `RATE_PER_USD` (units of the shop currency for 1 USD). The bridge never invents or fetches a rate; without it `/checkout` answers `422 needs_rate`.
- Conversion is exact integer maths on 6-decimal base units, rounded half up. Zero, negative, malformed, more-than-6-decimal and absurdly large totals are refused.
- If the merchant edits the draft's price after the invoice was made, the old invoice is not used to complete it: the payment is put under `reviews` for a person.
- Each invoice carries metadata `{shop, draftOrderId, shopifyTotal, shopifyCurrency, rate}` (orders placed with the manual method carry `orderId` instead of `draftOrderId`). Return links: `SHOP_URL/?stenmont=paid&draft=<id>` and `SHOP_URL/cart`.

## Getting access to a store (2026)

Since 1 January 2026 new Shopify apps are created in the **Dev Dashboard** and do not get a static Admin API token. The bridge therefore
gets a short-lived token itself.

1. Create the app in the Dev Dashboard. Set the scopes: `read_products`, `read_inventory`, `read_orders`, `write_orders`, `read_draft_orders`, `write_draft_orders`.
2. Release a version of the app.
3. Install it on the store with **custom distribution**: choose custom distribution, enter the store's `myshopify.com` domain, clear "Allow multi-store installs", generate the install link, and open it as the store owner.
4. Put the app's Client ID and Client secret into the bridge as `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`.

**Token.** The bridge calls the client credentials grant: `POST https://{shop}.myshopify.com/admin/oauth/access_token`, `application/x-www-form-urlencoded`,
body `grant_type=client_credentials&client_id=...&client_secret=...` (no `scope`: the token carries what the store granted). The answer has `access_token`,
`scope` and `expires_in` (always 86399, 24 hours). The token goes in the `X-Shopify-Access-Token` header, only to `https://{shop}/admin/...`, redirects refused.
It is cached in KV and treated as expired 5 minutes early; a 401 fetches a fresh one and retries once; concurrent requests share a single refresh
inside one Worker instance. It is never logged or returned. Source: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant

**When this works.** Only when the app and the store are in the **same organization** (both listed under the same org in the Dev Dashboard; a store made
from the Shopify admin is not automatically in your org). For any other store Shopify answers `shop_not_permitted`, and the bridge returns the error code
`shopify_shop_not_permitted` (and `shopify_invalid_client` for a wrong client id or secret). Other merchants would use the install link plus token exchange or the
authorization code grant. **That is not implemented here.** The docs do not give the HTTP status or JSON shape of these errors, so the bridge looks for the code in the body.

**Legacy override.** If a store already has a static Admin token (an older custom app), set `SHOPIFY_ADMIN_TOKEN`. It is then used as is: nothing is fetched or refreshed.

**What this is and is not.** Shopify's native checkout payment gateway needs Payments Partner approval (the Payments Apps API), and a public App Store listing needs
Shopify's review. This bridge is neither: it is the external-payment pattern (the customer leaves for the Stenmont pay page, and the order is completed afterwards),
installed one store at a time by custom distribution.

## Install, path A: theme snippet

1. Copy `theme/snippets/stenmont-pay.liquid` into the theme as `snippets/stenmont-pay.liquid`.
2. In the cart template add `{% render 'stenmont-pay', bridge_url: 'https://shopify-bridge-staging.stenmont.com' %}`.
3. Customers press **Pay with USDT**: the snippet reads `/cart.js`, posts variant ids and quantities to the bridge, and goes to the returned `https://` pay link.

Limits: the draft order is built from line items only. Discount codes, shipping rates and a logged-in customer's details are not carried over from the cart, so the draft total is what Shopify computes for those lines.

## Install, path B: manual payment method

1. Shopify admin, Settings, Payments, Manual payment methods, create a custom method named exactly `Pay with USDT (Stenmont)`.
2. Customers who pick it complete checkout normally. The order arrives as payment pending, `orders/create` reaches the bridge, and the bridge makes a Stenmont invoice for it. Its pay link is in `GET /orders` (`stenmont.payUrl`).
3. When that invoice is paid the bridge records the payment on the order.

Not built: showing the pay link to the customer automatically on the order status page. Today the link is in the feed, so the merchant (or a small email flow) sends it.

## Configuration (names only)

Secrets (`wrangler secret put <NAME> --env staging`):

| Name | What it is |
|---|---|
| `SHOPIFY_CLIENT_ID` | the Dev Dashboard app's Client ID |
| `SHOPIFY_CLIENT_SECRET` | the app's Client secret: used to get the Admin token, and Shopify signs webhooks with it |
| `SHOPIFY_WEBHOOK_SECRET` | optional; defaults to `SHOPIFY_CLIENT_SECRET`. Set it only if webhooks are signed with a different secret |
| `SHOPIFY_ADMIN_TOKEN` | optional legacy override: a static Admin token. When set, `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are not needed for API calls |
| `STENMONT_API_KEY` | a Stenmont API key for the business |
| `STENMONT_WEBHOOK_SECRET` | the signing secret of the webhook endpoint registered in Stenmont (below) |
| `BRIDGE_ADMIN_TOKEN` | a long random string you make up; guards `/invoice-send`, `/orders`, `/admin/*` |

Vars (`wrangler.jsonc`, `env.staging.vars`): `SHOPIFY_SHOP_DOMAIN` (`name.myshopify.com`), `STENMONT_API_URL`, `SHOP_URL` (public https address of the storefront), `ALLOWED_ORIGINS` (comma-separated exact origins, no `*`), and optional `RATE_PER_USD`.

## Deploy (not done yet; staging only)

1. `cd services/shopify-bridge && wrangler kv namespace create STATE --env staging`, paste the id into `env.staging.kv_namespaces`.
2. Fill the vars above for staging.
3. Put the secrets with `wrangler secret put ... --env staging`.
4. `pnpm deploy:staging` (serves `shopify-bridge-staging.stenmont.com`).
5. In Stenmont create a webhook endpoint for `https://shopify-bridge-staging.stenmont.com/webhooks/stenmont` (`POST /v1/webhook-endpoints`, events `invoice.paid` and `refund.created`); the secret in the response is `STENMONT_WEBHOOK_SECRET`. Set it, redeploy.
6. `curl -X POST https://shopify-bridge-staging.stenmont.com/admin/register-webhooks -H "authorization: Bearer $BRIDGE_ADMIN_TOKEN"`.
7. Make a test draft order in the dev store, `POST /checkout`, pay on the Stenmont page, watch the order turn paid.

## Security

Shop domain must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$` and the Admin token (and the client credentials request) is sent only to `https://{shop}/admin/...` with redirects refused. Secrets are never logged or returned; Shopify and Stenmont error text is never copied into responses. Shopify HMAC (base64, constant time) and Stenmont signatures (with replay window) are checked on the raw body before parsing. Admin routes compare the bearer in constant time. The mirror keeps id, number, total, currency, gateway names, status and timestamps only. Replays and out-of-order events change nothing (event ids, Shopify webhook ids, a `paid` record per draft, and "paid never goes backwards"). A Stenmont refund adds a tag and a note; it never refunds in Shopify. Each rule has a test in `services/shopify-bridge/test`.

## What was verified against shopify.dev (2026-11-06) and what was not

Read from the current docs (Admin GraphQL `latest`, which showed **2026-10**; the bridge uses `2026-10`):

- `draftOrderCreate`: `lineItems[{variantId, quantity}]`, returns `draftOrder.id` and `userErrors`; scope `write_draft_orders` or `write_quick_sale`. https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate
- `DraftOrder`: `status` (`COMPLETED`, `INVOICE_SENT`, `OPEN`), `totalPriceSet`, `order`, `lineItems`. https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder and `.../enums/DraftOrderStatus`
- `draftOrderComplete(id, paymentGatewayId, sourceName, paymentPending)`; returns `draftOrder { order }`; `paymentPending` is listed as deprecated. https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete
- `orderCreateManualPayment(id, amount, paymentMethodName, processedAt)`: the way to name the method; `amount` needs Shopify Plus; needs `write_orders` and the `mark_orders_as_paid` permission. https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCreateManualPayment
- `orderMarkAsPaid(input:{id})`: needs a positive balance and a non-`PAID` order; an already-paid order returns "Order cannot be marked as paid." https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderMarkAsPaid
- `draftOrderInvoiceSend(id, email)` with `EmailInput { bcc, body, customMessage, from, subject, to }`. https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderInvoiceSend and `.../input-objects/EmailInput`
- `webhookSubscriptionCreate(topic, webhookSubscription:{uri,...})` (examples use `uri`; `callbackUrl` is deprecated); `webhookSubscriptions(first, topics, uri)` returns `id topic uri`. https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate and `.../queries/webhookSubscriptions`
- Topics `ORDERS_CREATE`, `ORDERS_PAID`, `DRAFT_ORDERS_CREATE`, `DRAFT_ORDERS_UPDATE` exist (`read_orders` / `read_draft_orders`). https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic
- Webhook delivery: `X-Shopify-Hmac-SHA256` is base64 HMAC-SHA256 of the raw body with the app client secret; other headers include `X-Shopify-Topic`, `X-Shopify-Shop-Domain`, `X-Shopify-Webhook-Id`; respond 2xx within 5 seconds; 8 retries over 4 hours, then an API-created subscription is deleted; dedupe on the webhook id. https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- `Order` fields `note`, `tags`, `paymentGatewayNames`, `displayFinancialStatus` (`AUTHORIZED EXPIRED PAID PARTIALLY_PAID PARTIALLY_REFUNDED PENDING REFUNDED VOIDED`), `totalPriceSet`; `tagsAdd` supports Order and DraftOrder; `EmailInput` fields as above. https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
- The `orders/paid` sample payload contains `admin_graphql_api_id`, `name`, `total_price`, `currency`, `payment_gateway_names`, `financial_status`, `created_at`, `processed_at`, `test`.

Could not verify (the pages do not say; test on a development store first):

- Whether `draftOrderComplete(paymentPending: true)` still produces a payment-pending order on 2026-10 given the deprecation note, and what the default (no argument) does. If it returns an already-paid order the bridge skips the manual payment, so the order is paid but the method name is not recorded.
- Whether `orderCreateManualPayment` without `amount` records the full outstanding balance, and how it behaves on an already-paid order. The bridge falls back to `orderMarkAsPaid` if Shopify refuses, and fails (so Stenmont retries) if the order is still not `PAID`.
- Whether `orderUpdate` replaces `note` (assumed yes: the bridge reads the old note and appends).
- The HTTP status and JSON body of a failed token request (`shop_not_permitted`, `invalid_client`): the page names `shop_not_permitted` only.
- Required scopes for `webhookSubscriptionCreate`, `tagsAdd`, and the `webhookSubscriptions` query (not on those pages).
- That `id` and `total_price` in order webhooks are the numeric id and the shop-currency total (the bridge prefers `admin_graphql_api_id` and re-reads the total from the Admin API).
- Duplicate-subscription behaviour of `webhookSubscriptionCreate` (the bridge lists first to avoid it).
- The client credentials grant was read from the docs (request encoding, `access_token`, `scope`, `expires_in` = 86399, same-organization rule); it has not been run against a real store.
- Everything above has been exercised only against fakes. Nothing has run against a real Shopify store or a real Stenmont API.
