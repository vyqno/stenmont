import { pageMetadata } from "../../lib/seo";
import { API_URL, APP_URL } from "../../lib/docSamples";
import { Code, Note } from "./Code";


export const metadata = pageMetadata("/docs");

export default function Quickstart() {
  return (
    <>
      <h1>Quickstart</h1>
      <p>Stenmont is a commerce and finance platform for businesses using stablecoins. Sell from a storefront or connect your existing site, get paid in USDT, close the books and explore Capital. Scoped agents help connect and operate that loop; people retain consequential approvals.</p>
      <ul>
        <li><a href="/dashboard/catalog">Sell</a>: manage products and variants, then use a hosted storefront or your own checkout.</li>
        <li><a href="#checkout">Get paid</a>: create checkout on the server and match a signed payment event to the saved order.</li>
        <li><a href="/dashboard/books">Close the books</a>: reconcile records and export service-signed snapshots. Onchain anchoring is not enabled.</li>
        <li><a href="/dashboard/financing">Capital</a>: explore eligible receivables and investor funding. The live dashboard financing journey is still being verified; funding is not guaranteed.</li>
        <li><a href="/docs/mcp">Agents</a>: install through Connect and use scoped tools. Live finance chat verification is pending.</li>
      </ul>
      <p>The checkout below uses an invoice as its payment record. Customers pay from a passkey account or an existing wallet with their own USDT; the relayer covers network fees within configured limits.</p>
      <Note>Everything here runs on the test network at <code>{API_URL}</code>. Test USDT has no value. Use an already-funded payer account; Stenmont is not an on-ramp and does not supply payment funds.</Note>

      <h2>The fast way: let your AI agent do it</h2>
      <ol>
        <li>Sign in at <a href={`${APP_URL}/login`}>{APP_URL}/login</a> and open <a href="/dashboard/connect">Connect your site</a>.</li>
        <li>Add your site&apos;s address, pick your platform and copy the prompt.</li>
        <li>Paste it into your coding agent (Claude Code, Cursor, Copilot, ChatGPT). It builds the checkout and webhook and tells you where to put your secrets.</li>
        <li>Press <strong>Check again</strong>. You are done when all four checks pass.</li>
      </ol>

      <h2 id="checkout">Connect checkout yourself</h2>
      <h3 className="mt-6 font-bold">1. Get an API key</h3>
      <p>In the dashboard, open Settings and make a key. It starts with <code>sk_test_</code> and is shown once. Keep it on your server as <code>STENMONT_API_KEY</code>. Never put it in browser code.</p>
      <h3 className="mt-6 font-bold">2. Create a checkout</h3>
      <p>Create and durably save an <code>Idempotency-Key</code> with each order before checkout. Reuse that key and the same request body on retries; save the returned invoice ID and amount before redirecting.</p>
      <Code name="createInvoiceCurl" />
      <p>The answer contains <code>payUrl</code>. Send the customer there. When they have paid, they return to <code>successUrl</code>.</p>
      <Code name="createInvoiceFetch" />
      <h3 className="mt-6 font-bold">3. Listen for the payment</h3>
      <p>Register a webhook endpoint, keep its secret as <code>STENMONT_WEBHOOK_SECRET</code>, and mark the order paid when an <code>invoice.paid</code> event arrives. Always check the signature first. See <a href="/docs/webhooks">Webhooks</a>.</p>
      <h3 className="mt-6 font-bold">4. Run a test payment</h3>
      <p>Create an invoice for 1.00, open its <code>payUrl</code> and pay from an already-funded payer account. Then press Check again on the Connect page.</p>
      <p>Next: <a href="/docs/api">API</a>, <a href="/docs/sdk">SDK and React</a>, <a href="/docs/mcp">MCP</a>, <a href="/docs/x402">x402</a>.</p>
    </>
  );
}
