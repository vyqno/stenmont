// Writes public/llms-full.txt from the same samples the docs pages and the tests use.
// Run: pnpm --filter @stenmont/web llms   (Node 26 runs TypeScript directly)
import { writeFileSync } from "node:fs";
import { API_URL, APP_URL, MCP_URL, SAMPLES, X402_URL, type SampleName } from "../lib/docSamples.ts";

const fence = (name: SampleName) => `\`\`\`${SAMPLES[name].lang}\n${SAMPLES[name].code}\n\`\`\``;

const text = `# Stenmont: full reference for AI agents and developers

> Stenmont lets a business accept USDT payments on Whitechain without touching crypto. A customer pays with a passkey: no wallet, no gas. This file is the whole integration in one page. Short version: ${APP_URL}/llms.txt

Everything below is the TEST NETWORK (Whitechain Sepolia, test USDT). No real money moves. The production API is not live yet.

## Addresses

- API: ${API_URL}
- Dashboard and customer pay pages: ${APP_URL}
- MCP server (JSON-RPC over HTTP): ${MCP_URL}
- x402 facilitator: ${X402_URL}
- Human docs: ${APP_URL}/docs

## Authentication

Server to server: send the business's API key as "Authorization: Bearer $STENMONT_API_KEY". The key looks like sk_test_ followed by 32 hex characters. The business creates it in the dashboard (Settings, API keys) and it is shown once. Keep it in an environment variable or the host's secret settings. Never put it in browser code, theme files, HTML, logs or a repository. Never ask for it in a chat.

Every POST to /v1/ needs an "Idempotency-Key" header (any unique string up to 255 characters, a UUID is fine). Persist the key with the order before the first attempt. Reuse the same key and body on every retry. Save the returned invoice ID and amount before redirecting. Repeating a request with the same key returns the first answer instead of doing it twice.

Errors are JSON: {"error": {"code": "...", "message": "..."}}. Codes you will meet: invalid_request (400, with details), idempotency_key_required (400), unauthorized (401), payments_paused (403, the business paused payments in the dashboard), invoice_number_taken (409), rate_limited (429), chain_error (502, the invoice could not be created onchain; try again).

## Take a payment

Create an invoice on your server, then send the customer to its payUrl. They pay with a passkey and are sent back to successUrl. An invoice is the same thing as a checkout session.

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

Event types: invoice.created, invoice.partially_paid, invoice.paid, invoice.cancelled, invoice.reminder, refund.created, subscription.created, subscription.charged, subscription.past_due, subscription.cancelled, claim.funded, claim.settled, claim.defaulted. The dashboard's site check also sends site.test to your endpoint; answer 2xx.

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
- draft_refund (invoiceId, amount, to). It never sends money: it creates a pending request that a person must confirm with their passkey in the dashboard.

${fence("mcpList")}

Client configuration (Claude Code .mcp.json style):

${fence("mcpConfig")}

OAuth with PKCE is available for scoped agent connections; see ${APP_URL}/docs/mcp.

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
- Customers need a passkey (Face ID, fingerprint or device PIN). An agent cannot pay on their behalf.
- Amounts are USD-style decimals. Convert other currencies yourself before creating the invoice.
- On-chain data (sender, receiver, amount, time) is public. Invoice details and customer emails stay off-chain.
`;

writeFileSync(new URL("../public/llms-full.txt", import.meta.url), text);
console.log("wrote public/llms-full.txt", text.length, "bytes");
