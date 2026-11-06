// Writes public/llms-full.txt from the same samples the docs pages and the tests use.
// Run: pnpm --filter @stenmont/web llms   (Node 26 runs TypeScript directly)
import { writeFileSync } from "node:fs";
import { EVENT_TYPES } from "../../../services/api/src/events.ts";
import { publicPaths, ROUTES } from "../lib/seo.ts";
import { API_URL, APP_URL, MCP_URL, SAMPLES, X402_URL, type SampleName } from "../lib/docSamples.ts";

const fence = (name: SampleName) => `\`\`\`${SAMPLES[name].lang}\n${SAMPLES[name].code}\n\`\`\``;

const text = `# Stenmont: full reference for AI agents and developers

> Stenmont is the commerce and finance platform for businesses using stablecoins. Sell, get paid, close the books and explore Capital; scoped agents help connect and operate that loop. Customers bring their own USDT and pay with a passkey account or existing wallet. This file covers the interfaces and their limits in one place. Short version: ${APP_URL}/llms.txt

Everything below is the TEST NETWORK (Whitechain Sepolia, test USDT). No real money moves. The production API is not live yet.

## Addresses

- API: ${API_URL}
- Dashboard and customer pay pages: ${APP_URL}
- MCP server (JSON-RPC over HTTP): ${MCP_URL}
- x402 facilitator: ${X402_URL}
- Human docs: ${APP_URL}/docs

## The business loop

- Sell: manage products and variants in the catalogue, publish a hosted storefront or connect an existing shop, and price checkout on the server.
- Get paid: USDT checkout, invoices and signed webhooks keep the order, payment and receipt connected.
- Close the books: reconcile recorded movements and export service-signed period snapshots with line proofs. No onchain anchor is configured.
- Capital: explore eligible test-network receivables and investor funding terms. The live dashboard financing journey and router v2 activation remain pending; no funding is guaranteed.
- Agents: a coding agent can install checkout through Connect; scoped MCP/OAuth tools can read records and prepare drafts. Human money approvals stay in place. The finance chat provider backend is implemented, but a successful live reply is not yet verified.

## Authentication

Server to server: send the business's API key as "Authorization: Bearer $STENMONT_API_KEY". The key looks like sk_test_ followed by 32 hex characters. The business creates it in the dashboard (Settings, API keys) and it is shown once. Keep it in an environment variable or the host's secret settings. Never put it in browser code, theme files, HTML, logs or a repository. Never ask for it in a chat.

Every POST to /v1/ needs an "Idempotency-Key" header (any unique string up to 255 characters, a UUID is fine). Persist the key with the order before the first attempt. Reuse the same key and body on every retry. Save the returned invoice ID and amount before redirecting. Repeating a request with the same key returns the first answer instead of doing it twice.

Errors are JSON: {"error": {"code": "...", "message": "..."}}. Codes you will meet: invalid_request (400, with details), idempotency_key_required (400), unauthorized (401), payments_paused (403, the business paused payments in the dashboard), invoice_number_taken (409), rate_limited (429), chain_error (502, the invoice could not be created onchain; try again).

## Take a payment

Create an invoice on your server, then send the customer to its payUrl. They pay with a passkey and are sent back to successUrl. Each checkout session uses an invoice as its payment record.

POST ${API_URL}/v1/invoices
- amount (required): dollars as a decimal string, at most 6 decimals, greater than zero, for example "25.00".
- successUrl, cancelUrl: where the pay page sends the customer. Public https addresses only.
- metadata: up to 10 string pairs, returned in every webhook. Put your own order id in metadata.order.
- number (optional invoice number, unique per business), customerEmail, dueDate (ISO 8601).

The response includes id, number, status, amount, amountPaid, amountRefunded, metadata and payUrl. status is one of open, partially_paid, paid, cancelled, failed.

${fence("createInvoiceCurl")}

${fence("createInvoiceFetch")}

Work out the amount on your server from your own price list. Never trust an amount sent by the browser.

Also available: GET /v1/invoices (query: status, limit), GET /v1/invoices/{id}, POST /v1/payment-links, POST /v1/refunds, POST /v1/subscriptions, GET /v1/exports/payments.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&format=generic|quickbooks.

A refund request is drafted through the API but only moves money after the business approves it with its passkey in the dashboard. Refunds above the business's threshold also need a World approval.

## Webhooks

Register an endpoint: POST ${API_URL}/v1/webhook-endpoints with {"url": "https://your-site.example/webhooks/stenmont", "events": ["invoice.paid"]}. The URL must be public https. "events" is optional; leave it out to get every event. The response contains "secret" (starts with whsec_) exactly once. Store it as STENMONT_WEBHOOK_SECRET without printing it.

Event types: ${EVENT_TYPES.join(", ")}. The dashboard's site check also sends site.test to your endpoint; answer 2xx.

Delivery is a POST with a JSON body {id, type, created, data, livemode} and these headers: Stenmont-Signature, Stenmont-Event-Id, Content-Type: application/json. Answer with any 2xx within 10 seconds. Anything else is retried up to 10 times, starting after 20 seconds and doubling up to one hour. Delivery is at least once. After signature verification, load the stored order binding and check invoice ID, status and amount. Atomically mark the order paid once and deduplicate event IDs; never fulfil from metadata or a success redirect alone.

${fence("webhookEvent")}

### Verify the signature (always)

Header format: Stenmont-Signature: t=<unix seconds>,v1=<hex>
1. Take the RAW request body, exactly as received, before any JSON parsing.
2. Compute HMAC-SHA256 with the webhook secret as the key over the text "<t>.<raw body>", as lowercase hex.
3. Compare it to v1 in constant time. While a secret is being rotated the header carries two v1 values: accept if either matches.
4. Reject if t is more than 300 seconds from now (replay protection).
5. Only then parse the JSON.

${fence("verifyNode")}

${fence("verifyPython")}

With the SDK:

${fence("sdkWebhook")}

## SDK and React

The packages are @stenmont/sdk (server) and @stenmont/react (button). They are not on npm yet; until they are, use the HTTP API above, which needs no package. The SDK is a thin wrapper over the same calls.

${fence("sdkCheckout")}

${fence("sdkMore")}

${fence("reactButton")}

PayButton is a plain link. It refuses anything that is not an http or https address.

## MCP (for agents that manage a business)

Server: ${MCP_URL}. Send POST requests with "Authorization: Bearer $STENMONT_API_KEY". Protocol: JSON-RPC 2.0 (initialize, tools/list, tools/call). Tools:
- list_invoices (status, limit)
- get_invoice (id)
- export_payments (from, to, format)
- list_overdue (read only).
- draft_reminder (invoiceId). Queues fixed text for merchant review; sends no email.
- propose_plan (invoiceId, instalments, b2b, payerBusinessName, extensionDays). Only two or three B2B parts are supported; outside-policy extensions require World approval and still need merchant review. Nothing executes automatically.
- draft_refund (invoiceId, amount, to). It never sends money: it creates a pending request that a person must confirm with their passkey in the dashboard.

${fence("mcpList")}

Client configuration (Claude Code .mcp.json style):

${fence("mcpConfig")}

OAuth with PKCE is available for scoped agent connections; see ${APP_URL}/docs/mcp.

## Recorded books and scoped agent discovery

Authenticated GET /v1/books/YYYY-MM returns a reconciliation. POST /v1/books/YYYY-MM/close creates a signed locked bundle only when signing is configured; a staging interim snapshot is explicitly labelled. Exports and line proofs live under that period. The service signature attests recorded lines, not completeness; onchain anchoring is unavailable unless a registry is separately approved and configured. Do not close a period without the merchant reviewing its flags.

A2A discovery: /.well-known/agent-card.json, business card /a2a/{merchantId}/agent-card.json, and ENS text stenmont.a2a. Current wire header is A2A-Version: 1.0; JSON-RPC SendMessage, GetTask and CancelTask. Business access is opt-in. Supported skills are quote, create_invoice_draft, check_invoice_status, get_pay_link and list_catalogue. A draft is not payable and never executes money movement. Discovery alone does not authorize sending credentials. Node clients pin validated public IPv4 addresses and refuse redirects. See repository docs/A2A.md for exact limitations.

The dashboard finance assistant is separately configured and can be disabled. Its provider fixtures are not live-provider evidence. Never ask for a provider key in chat.

## x402: charge an AI agent per request

An x402 endpoint answers 402 with its price; a paying client signs a USDT authorization and retries; the facilitator at ${X402_URL} verifies and settles it on Whitechain and pays the gas. Network eip155:1874, scheme exact, x402 version 2, official USDT 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 (6 decimals). Headers: PAYMENT-REQUIRED (from the server), PAYMENT-SIGNATURE (from the client), PAYMENT-RESPONSE (settlement result). The facilitator only settles to payee addresses on its allowlist; ask the operator to add yours. @stenmont/x402 and @stenmont/agent are not on npm yet.

${fence("x402Server")}

${fence("x402Agent")}

The agent's limits are checked before anything is signed: per request, per day, and which hosts may be paid.

## Install Stenmont on a website (the agent flow)

1. The owner signs in at ${APP_URL}/login and opens ${APP_URL}/dashboard/connect.
2. They add the site's address (https only). The page shows a DNS TXT record to add: name _stenmont.<host>, value stenmont-verify=<token>.
3. They pick their platform (Next.js, plain HTML, Shopify theme, WooCommerce, Webflow, other), copy the prompt and paste it into their AI coding agent.
4. The agent builds a server-side checkout, a webhook handler and a Pay button, following the rules above, and keeps the key out of client code.
5. A test payment: the agent creates a 1.00 invoice with successUrl on the site and gives the owner its payUrl; the owner pays with a passkey (use an already-funded payer account; Stenmont does not supply payment funds).
6. The dashboard shows four checks, each with a time: site reachable, domain verified (DNS), webhook answers 2xx to a signed site.test event, test payment paid. A live/paused switch stops new invoices (403 payments_paused) and shows customers a "temporarily unavailable" page.

## Limits you should know about

- Test network only. Test USDT has no value.
- Customers can use a passkey account or an existing wallet with their own USDT. An x402 agent signs only with its own separately authorized payer credentials; connecting to merchant MCP does not authorize spending customer money.
- Amounts are USDT decimals. Set explicit USDT prices; Stenmont does not perform currency conversion, and another currency must never simply be relabelled.
- On-chain data (sender, receiver, amount, time) is public. Invoice details and customer emails stay off-chain.
`;

writeFileSync(new URL("../public/llms-full.txt", import.meta.url), text);
console.log("wrote public/llms-full.txt", text.length, "bytes");

const short = `# Stenmont

> The agentic business kit for stablecoin commerce and finance: storefronts, USDT checkout, books, Capital and scoped agents. Test network only. Payers bring their own USDT; Stenmont does not fund wallets. Full reference: ${APP_URL}/llms-full.txt

Facts an agent needs:
- API: ${API_URL}. Server-side Authorization: Bearer $STENMONT_API_KEY; never put credentials in a browser, repository or chat.
- Persist an Idempotency-Key with the order before a checkout attempt; reuse it on retries.
- Verify the raw webhook body with Stenmont-Signature and STENMONT_WEBHOOK_SECRET, then bind the stored invoice ID, amount and paid status before atomic fulfilment.
- Connect: ${APP_URL}/dashboard/connect; finish only after its four checks pass.
- SDK and React packages are not published. Use HTTP until publication is explicitly approved.

## Docs

${publicPaths.filter(p => p.startsWith("/docs")).map(p => `- [${ROUTES[p][0]}](${APP_URL}${p}): ${ROUTES[p][1]}`).join("\n")}

## Optional

- [Full reference](${APP_URL}/llms-full.txt): integration samples, current webhook events and MCP tools
- [Documentation sitemap](${APP_URL}/docs/sitemap.xml): public documentation inventory
`;
writeFileSync(new URL("../public/llms.txt", import.meta.url), short);
