import { pageMetadata } from "../../../lib/seo";
import { X402_URL } from "../../../lib/docSamples";
import { Code, Note } from "../Code";


export const metadata = pageMetadata("/docs/x402");

export default function X402() {
  return (
    <>
      <h1>x402</h1>
      <p>x402 lets a server charge for a single request and an agent pay for it, with no account and no checkout. The server answers <code>402</code> with a price. The agent signs a USDT authorization and asks again. A facilitator checks the signature and settles it on Whitechain, paying the network fee.</p>
      <ul>
        <li>Facilitator (test network): <code>{X402_URL}</code></li>
        <li>Network <code>eip155:1874</code>, scheme <code>exact</code>, x402 version 2, the official USDT with 6 decimals.</li>
        <li>Headers: <code>PAYMENT-REQUIRED</code> (server), <code>PAYMENT-SIGNATURE</code> (agent), <code>PAYMENT-RESPONSE</code> (result).</li>
      </ul>

      <h2>Charge for an endpoint</h2>
      <Code name="x402Server" />
      <p>The facilitator only settles to payee addresses on its allowlist. Ask the operator to add yours. The paywall discards your response if settlement fails, so content never leaves unpaid.</p>

      <h2>Pay as an agent, inside limits</h2>
      <Code name="x402Agent" />
      <p>The limits are checked before anything is signed: one price too high, the day&apos;s total, or a host that is not on the list all stop the payment.</p>
      <Note><code>@vyqno/x402</code> and <code>@vyqno/agent</code> are not on npm yet; they live in the repository under <code>packages/</code>.</Note>
    </>
  );
}
