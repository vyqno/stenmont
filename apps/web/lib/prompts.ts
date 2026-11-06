/**
 * The text a business pastes into its AI coding agent. Pure: it gets public ids and addresses only, so it cannot contain a
 * secret. The API key and the webhook secret are named by environment variable and never written here.
 */
export type Platform = "nextjs" | "html" | "shopify" | "woocommerce" | "webflow" | "other";

export const PLATFORMS: { id: Platform; label: string; blurb: string }[] = [
  { id: "nextjs", label: "Next.js", blurb: "App Router site with its own server code." },
  { id: "html", label: "Plain HTML", blurb: "A static site. One small server function is added for the secret." },
  { id: "shopify", label: "Shopify theme", blurb: "A button in the theme plus a small server function." },
  { id: "woocommerce", label: "WooCommerce", blurb: "A small payment plugin for WordPress." },
  { id: "webflow", label: "Webflow", blurb: "An embed on the page plus a small server function." },
  { id: "other", label: "Something else", blurb: "Any stack that can make HTTP requests on a server." },
];

export type PromptInput = {
  platform: Platform;
  /** The API this dashboard talks to, for example https://api-staging.stenmont.com. */
  apiUrl: string;
  /** The dashboard's own address; the docs and the status page live there. */
  appUrl: string;
  businessName: string;
  merchantId: string;
  /** A registered site and the DNS record that proves it is theirs (public by design). */
  site?: { url: string; recordName: string; recordValue: string };
};

const SECRET = /sk_test_[0-9a-f]{32}|whsec_[0-9a-f]{20,}|-----BEGIN|\b0x[0-9a-f]{64}\b/i;
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

const WEBHOOK_RULES = `The webhook handler must:
- read the RAW request body (the exact bytes, before any JSON parsing);
- read the Stenmont-Signature header, which looks like t=<unix seconds>,v1=<hex>;
- compute HMAC-SHA256 with STENMONT_WEBHOOK_SECRET over the text "<t>.<raw body>" and compare it to v1 in constant time (the header can carry two v1 values while a secret is being rotated; accepting either is correct);
- refuse the request with 400 if the signature is wrong or t is more than 300 seconds from now;
- on type "invoice.paid", find the order using event.data.invoice.metadata.order, but only mark it paid when event.data.invoice.id matches its stored invoice id, the invoice amount matches the stored order amount using integer base-unit comparison, and amountPaid covers that full amount. Metadata alone never authorizes fulfilment. Reject a mismatch. Repeated valid events must be safe;
- answer 200 for any other event type, including "site.test" (the dashboard sends that one to check your handler);
- answer within a few seconds, and never log the secret or the full signature.`;

const CHECKOUT_RULES = `Creating the checkout (on the server only):
- POST <API>/v1/invoices with headers "Authorization: Bearer <STENMONT_API_KEY>", "Content-Type: application/json" and "Idempotency-Key: <the order’s saved checkout UUID>"; create this UUID once with the order, and use the same saved key after double-clicks, timeouts and retries.
- Body: {"amount": "<price as a decimal string with at most 6 decimals, in dollars>", "successUrl": "<page on the site to return to>", "cancelUrl": "<page on the site to return to>", "metadata": {"order": "<the shop's own order id>"}}. successUrl and cancelUrl must be public https addresses.
- Work out the amount on the server from the shop's own price list or order, never from a number the browser sent.
- The response has "id" and "payUrl". Save the returned invoice id on the order before redirecting, and reuse that invoice for later clicks. Handle an early webhook by retrying it until the invoice binding is stored. Send the customer to payUrl. They pay with a passkey; nothing to install, no wallet, no gas.
- Errors come back as {"error": {"code", "message"}}. A 403 "payments_paused" means the owner paused payments in the dashboard: show "Payments are temporarily unavailable" and stop.`;

const STEPS: Record<Platform, string> = {
  nextjs: `Next.js (App Router). Read the project first (package.json, the app directory, how the cart or order is built) and follow its conventions.
1. Create a route handler app/api/checkout/route.ts (POST). It builds the order on the server, calls Stenmont as described under "Creating the checkout", and returns the payUrl (or a redirect to it).
2. Create app/api/webhooks/stenmont/route.ts (POST). Use "await request.text()" for the raw body and Node's crypto (createHmac, timingSafeEqual) or Web Crypto. Do not use request.json() before verifying.
3. Add a "Pay" button on the page where the customer finishes their order. It posts to /api/checkout and then goes to the returned payUrl. The page must not contain the API key.
4. Add STENMONT_API_KEY, STENMONT_WEBHOOK_SECRET and STENMONT_API_URL to the deployment's environment variables (and to .env.local for development, which is git-ignored). Add the names, without values, to .env.example.`,

  html: `Plain HTML. A static page cannot keep a secret, so the key must live in one small server function. Ask the owner where the site is hosted (Netlify, Vercel, Cloudflare Pages or Workers, something else) and use that host's functions. If it has none, create a Cloudflare Worker.
1. Write the function "create-checkout" (POST). It calls Stenmont as described under "Creating the checkout" and returns {"url": payUrl}. It must choose the amount itself (a fixed price per product id kept in the function), never trust the page.
2. Write the function "stenmont-webhook" (POST) that follows the webhook rules and records the order as paid wherever the owner keeps orders (ask; a simple KV or database table is fine).
3. In the page, add a button. Its script posts the product id to create-checkout and sets window.location to the returned url. Use only the function's address in the page.
4. Put STENMONT_API_KEY and STENMONT_WEBHOOK_SECRET in the host's secret settings, never in the HTML, a script file, or the repository.`,

  shopify: `Shopify theme. Liquid and theme JavaScript run in the customer's browser and cannot keep a secret, and a Stenmont invoice must be priced on the server. So the work has two parts.
1. A small server function (Cloudflare Worker, or whatever the owner already uses) with two routes. "create-checkout" receives a draft order id, reads that draft order's total from the Shopify Admin API on the server, then calls Stenmont as described under "Creating the checkout" with metadata {"order": "<draft order id>"}. "stenmont-webhook" follows the webhook rules and, on invoice.paid, completes that draft order as paid through the Admin API. Keep the Shopify Admin token and the Stenmont key in the function's secrets.
2. A theme snippet (snippets/stenmont-pay.liquid) that renders a "Pay with Stenmont" button on the cart page. Its handler asks the function to turn the current cart into a draft order and then goes to the payUrl it returns. Add {% render 'stenmont-pay' %} to the cart template.
3. Stenmont amounts are in dollars. If the shop's currency is not USD, stop and ask the owner how prices should be converted before writing any code.`,

  woocommerce: `WooCommerce (WordPress). Add a small plugin, wp-content/plugins/stenmont-gateway/stenmont-gateway.php.
1. Define a class that extends WC_Payment_Gateway, id "stenmont", and register it with the woocommerce_payment_gateways filter.
2. In process_payment($order_id), call Stenmont with wp_remote_post as described under "Creating the checkout": amount from $order->get_total() (a string with 2 decimals), successUrl from $this->get_return_url($order), cancelUrl from wc_get_checkout_url(), metadata {"order": "<order id>"}. Return ['result' => 'success', 'redirect' => payUrl]. On any error, call wc_add_notice and return ['result' => 'failure'].
3. Register a webhook endpoint with add_action('woocommerce_api_stenmont', ...). Read the raw body with file_get_contents('php://input'), compute hash_hmac('sha256', $t . '.' . $raw, STENMONT_WEBHOOK_SECRET) and compare with hash_equals. On invoice.paid call $order->payment_complete() (skip it when the order is already paid).
4. Read the key and secret from constants (define STENMONT_API_KEY and STENMONT_WEBHOOK_SECRET in wp-config.php, which is not committed), never from an admin settings field or a theme file. If the store currency is not USD, stop and ask the owner how prices should be converted.`,

  webflow: `Webflow. Webflow pages are static and cannot run server code or keep a secret, so the key goes in one small server function and the page only calls it.
1. Create the function "create-checkout" and the function "stenmont-webhook" exactly as the plain-HTML plan describes (a Cloudflare Worker is fine). The function sets the price itself from a product id.
2. In Webflow, add an Embed element (or a page's custom code) with a button and a few lines of JavaScript that post the product id to create-checkout and then set window.location to the returned url. No key, no secret in the embed.
3. Publish the site and give the owner the exact steps you could not do yourself (Webflow designer changes need their account).`,

  other: `Any other stack. Read the project first and use the language and framework it already uses.
1. On the server, add an endpoint that creates the checkout as described under "Creating the checkout" and returns or redirects to payUrl.
2. On the server, add the webhook endpoint that follows the webhook rules.
3. Add a "Pay" button where the customer finishes their order; it calls your endpoint and then goes to payUrl.
4. Keep STENMONT_API_KEY and STENMONT_WEBHOOK_SECRET in the platform's secret or environment settings. If the platform cannot make server-side requests at all, stop and tell the owner.`,
};

export function buildPrompt(input: PromptInput): string {
  const name = oneLine(input.businessName, 80);
  const merchantId = oneLine(input.merchantId, 80);
  const platform = PLATFORMS.find((p) => p.id === input.platform)?.label ?? "Something else";
  const api = input.apiUrl.replace(/\/+$/, "");
  const app = input.appUrl.replace(/\/+$/, "");

  const site = input.site
    ? `The owner has registered this site with Stenmont: ${oneLine(input.site.url, 200)}
To prove the domain is theirs they must add a DNS TXT record (you cannot do this for them, so tell them exactly this):
  name:  ${oneLine(input.site.recordName, 200)}
  value: ${oneLine(input.site.recordValue, 200)}`
    : `No site is registered yet. Tell the owner to register the site's address (https only) on ${app}/dashboard/connect first; that page then shows the DNS record that proves the domain.`;

  const text = `You are installing Stenmont, a way to accept USDT payments, on the website of ${name}. The platform is: ${platform}.

FACTS
- Business: ${name} (id ${merchantId})
- Stenmont API: ${api}  (this is the test network; no real money moves)
- Machine-readable docs: ${app}/llms.txt  (full version: ${app}/llms-full.txt, human docs: ${app}/docs)
- ${site.split("\n").join("\n  ")}

RULES
- Secrets: the API key is STENMONT_API_KEY and the webhook secret is STENMONT_WEBHOOK_SECRET. Never put either in client code, browser JavaScript, theme files, HTML, logs, the repository or this chat. Never commit them. Do not ask the owner to paste a key into the chat: tell them where to put it (an environment variable or the host's secret settings) and let them do it. If the webhook secret is returned by an API call, send it straight to the secret store without printing it.
- Do not write your own cryptography beyond the HMAC check below. Do not change files unrelated to checkout. Do not add dependencies you do not need; plain HTTP requests are enough and no Stenmont package is required.
- Money amounts are decimal strings in dollars with at most 6 decimals, for example "25.00".

PLAN
${STEPS[input.platform]}

${CHECKOUT_RULES}

${WEBHOOK_RULES}

Register the webhook endpoint with POST ${api}/v1/webhook-endpoints, body {"url": "<your handler's public https address>"}, using the owner's API key from the environment and an Idempotency-Key header holding a saved UUID for this webhook registration. The response contains the signing secret exactly once: store it as STENMONT_WEBHOOK_SECRET without printing it.

TEST PAYMENT
1. Create an invoice for "1.00" with successUrl and cancelUrl pages on the site, and print its payUrl.
2. Ask the owner to pay using a supported payer account that already holds test USDT. Do not fund wallets with the merchant’s, relayer’s or platform’s USDT. If a funded payer cannot use the hosted flow yet, stop and identify the missing payment path; never imply an unbuilt wallet option exists. You cannot sign for the owner. A separately authorized existing-wallet relay test may prove the receipt, but label that route accurately.
3. Confirm your webhook handler marked the order paid, and show the owner where.

DONE MEANS
- A customer can go from the site's checkout to the Stenmont pay page and back to the site.
- The webhook handler rejects a wrong signature and an old timestamp, and accepts a good one (run a quick check of both).
- The test payment is paid and the order is marked paid.
- No secret appears in any file you changed (search your diff for "sk_test" and "whsec_").
- ${app}/dashboard/connect shows all four checks green after the owner presses "Check again": site reachable, domain verified, webhook answered, test payment paid.
Finish by listing every file you created or changed and anything the owner still has to do themselves. Do not say you are done until those four checks are green.`;

  if (SECRET.test(text)) throw new Error("Refusing to build a prompt that contains something that looks like a secret");
  return text;
}
