import type { Metadata } from "next";
import { API_URL } from "../../../lib/docSamples";
import { Code, Note } from "../Code";

export const metadata: Metadata = { title: "Webhooks · Stenmont docs", description: "Events, retries and how to verify the signature." };

export default function Webhooks() {
  return (
    <>
      <h1>Webhooks</h1>
      <p>Stenmont tells your server about a payment by POSTing a signed event to an address you register.</p>

      <h2>Register an endpoint</h2>
      <p><code>POST {API_URL}/v1/webhook-endpoints</code> with <code>{`{"url": "https://your-site.example/webhooks/stenmont"}`}</code>. The address must be public https. Add <code>events</code> to receive only some types. The response contains <code>secret</code> (starts with <code>whsec_</code>) <strong>once</strong>. Keep it as <code>STENMONT_WEBHOOK_SECRET</code>.</p>

      <h2>Events</h2>
      <p><code>invoice.created</code>, <code>invoice.partially_paid</code>, <code>invoice.paid</code>, <code>invoice.cancelled</code>, <code>invoice.reminder</code>, <code>refund.created</code>, <code>subscription.created</code>, <code>subscription.charged</code>, <code>subscription.past_due</code>, <code>subscription.cancelled</code>, <code>claim.funded</code>, <code>claim.settled</code>, <code>claim.defaulted</code>. The Connect page also sends <code>site.test</code> to check your handler; answer it with 2xx.</p>
      <Code name="webhookEvent" />

      <h2>Delivery</h2>
      <p>Answer any 2xx within 10 seconds. Otherwise Stenmont retries up to 10 times, after 20 seconds and then doubling up to an hour. Delivery is at least once. After signature verification, match the stored invoice ID, paid status and expected amount to the order. Atomically fulfil once and deduplicate event IDs. Never fulfil from metadata or a return URL alone.</p>

      <h2>Verify the signature</h2>
      <p>Never act on an event you have not verified. The header looks like <code>Stenmont-Signature: t=1793960000,v1=9f2c…</code>.</p>
      <ol>
        <li>Take the <strong>raw</strong> request body, exactly as received. Do not parse it first.</li>
        <li>Compute HMAC-SHA256 with your webhook secret as the key over the text <code>{"<t>.<raw body>"}</code>, as lowercase hex.</li>
        <li>Compare it with <code>v1</code> in constant time. While a secret is rotated the header carries two <code>v1</code> values; either may match.</li>
        <li>Reject if <code>t</code> is more than 300 seconds from now.</li>
        <li>Then parse the JSON.</li>
      </ol>
      <h3 className="mt-6 font-bold">Node</h3>
      <Code name="verifyNode" />
      <h3 className="mt-6 font-bold">Python</h3>
      <Code name="verifyPython" />
      <h3 className="mt-6 font-bold">With the SDK</h3>
      <Code name="sdkWebhook" />
      <Note>These samples are run by the project&apos;s tests against the signer the server uses, so a copy that works here works in production.</Note>
    </>
  );
}
