import type { Metadata } from "next";
import { API_URL } from "../../../lib/docSamples";
import { Code, Note } from "../Code";

export const metadata: Metadata = { title: "SDK and React · Stenmont docs", description: "The server client and the Pay button." };

export default function Sdk() {
  return (
    <>
      <h1>SDK and React</h1>
      <Note><code>@stenmont/sdk</code> and <code>@stenmont/react</code> are not on npm yet. Until they are, call the HTTP API directly (see the <a href="/docs">Quickstart</a>); the SDK is a thin wrapper over the same calls and lives in the repository under <code>packages/sdk</code>.</Note>

      <h2>Create a checkout</h2>
      <p>Set <code>baseUrl</code> to <code>{API_URL}</code> while testing. The default is production, which is not live yet.</p>
      <Code name="sdkCheckout" />

      <h2>Invoices, refunds, subscriptions, export</h2>
      <Code name="sdkMore" />
      <p>A refund created here is only a request. Nothing moves until the business approves it with its passkey in the dashboard.</p>

      <h2>The Pay button</h2>
      <p><code>PayButton</code> is a plain link to the pay page, so it works without JavaScript. It refuses any address that is not http or https.</p>
      <Code name="reactButton" />

      <h2>Verify webhooks</h2>
      <Code name="sdkWebhook" />
    </>
  );
}
