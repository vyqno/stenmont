import type { Metadata } from "next";
import { API_URL } from "../../../lib/docSamples";
import { Code } from "../Code";

export const metadata: Metadata = { title: "API · Stenmont docs", description: "Authentication, invoices, errors and idempotency." };

export default function Api() {
  return (
    <>
      <h1>API</h1>
      <p>Base address while testing: <code>{API_URL}</code>. JSON in, JSON out.</p>

      <h2>Authentication</h2>
      <p>Send your key as <code>Authorization: Bearer $STENMONT_API_KEY</code> from your server. Keys are made and revoked in the dashboard under Settings. A key is shown in full only once.</p>

      <h2>Idempotency</h2>
      <p>Every POST to <code>/v1/</code> needs an <code>Idempotency-Key</code> header (up to 255 characters; a UUID is fine). Repeat a request with the same key and you get the first answer back instead of a second action. Use a new key for a new action.</p>

      <h2>Create an invoice (a checkout)</h2>
      <p><code>POST /v1/invoices</code></p>
      <ul>
        <li><code>amount</code> (required): dollars as a decimal string, at most 6 decimals, above zero, for example <code>&quot;25.00&quot;</code>.</li>
        <li><code>successUrl</code>, <code>cancelUrl</code>: where the pay page sends the customer. Public https addresses only.</li>
        <li><code>metadata</code>: up to 10 string pairs. Put your own order id in <code>metadata.order</code>; it comes back in every webhook.</li>
        <li><code>number</code>, <code>customerEmail</code>, <code>dueDate</code>: optional.</li>
      </ul>
      <Code name="createInvoiceCurl" />
      <p>The response has <code>id</code>, <code>number</code>, <code>status</code> (<code>open</code>, <code>partially_paid</code>, <code>paid</code>, <code>cancelled</code> or <code>failed</code>), <code>amount</code>, <code>amountPaid</code>, <code>amountRefunded</code>, <code>metadata</code> and <code>payUrl</code>. Work out the amount on your server. Never trust an amount sent by the browser.</p>

      <h2>Other endpoints</h2>
      <ul>
        <li><code>GET /v1/invoices</code> (query <code>status</code>, <code>limit</code>) and <code>GET /v1/invoices/{"{id}"}</code></li>
        <li><code>POST /v1/payment-links</code>, <code>GET /v1/payment-links</code></li>
        <li><code>POST /v1/webhook-endpoints</code>, <code>GET</code>, <code>DELETE /v1/webhook-endpoints/{"{id}"}</code></li>
        <li><code>POST /v1/refunds</code>: drafts a refund; the business approves it with its passkey.</li>
        <li><code>POST /v1/subscriptions</code>, <code>GET /v1/subscriptions</code>, <code>POST /v1/subscriptions/{"{id}"}/cancel</code></li>
        <li><code>GET /v1/exports/payments.csv?from=2026-11-01&amp;to=2026-11-30&amp;format=generic|quickbooks</code></li>
        <li><code>GET /v1/sites</code> and <code>GET /v1/payment-switch</code>: the status checks and the live/paused switch behind the Connect page.</li>
      </ul>

      <h2>Errors</h2>
      <p>Errors look like <code>{`{"error": {"code": "...", "message": "..."}}`}</code>.</p>
      <ul>
        <li><code>invalid_request</code> (400): a field is wrong; <code>details</code> says which.</li>
        <li><code>idempotency_key_required</code> (400)</li>
        <li><code>unauthorized</code> (401): missing or revoked key.</li>
        <li><code>payments_paused</code> (403): the business paused payments. Show customers that payments are temporarily unavailable.</li>
        <li><code>invoice_number_taken</code> (409)</li>
        <li><code>rate_limited</code> (429): wait a minute.</li>
        <li><code>chain_error</code> (502): the invoice could not be created; try again.</li>
      </ul>
    </>
  );
}
