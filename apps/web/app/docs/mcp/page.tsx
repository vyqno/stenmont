import { pageMetadata } from "../../../lib/seo";
import { MCP_URL } from "../../../lib/docSamples";
import { Code, Note } from "../Code";


export const metadata = pageMetadata("/docs/mcp");

export default function Mcp() {
  return (
    <>
      <h1>MCP</h1>
      <p>The Stenmont MCP server lets an AI agent work with a business&apos;s invoices. It is at <code>{MCP_URL}</code> and speaks JSON-RPC 2.0 over HTTP POST.</p>

      <h2>Sign in</h2>
      <p>Send the business&apos;s API key as <code>Authorization: Bearer $STENMONT_API_KEY</code>. The server passes it through to the API and stores nothing. Sign-in with OAuth is planned and is not available yet.</p>

      <h2>Tools</h2>
      <ul>
        <li><code>list_invoices</code>: newest first; optional <code>status</code> and <code>limit</code>.</li>
        <li><code>get_invoice</code>: one invoice by id, with what was paid and refunded.</li>
        <li><code>export_payments</code>: payments and refunds between two dates as CSV, <code>generic</code> or <code>quickbooks</code>.</li>
        <li><code>draft_refund</code>: prepares a refund. <strong>It never sends money.</strong> A person must confirm it with a passkey in the dashboard, and large refunds also need a World approval.</li>
      </ul>
      <Code name="mcpList" />

      <h2>Connect a client</h2>
      <p>For Claude Code, add this to <code>.mcp.json</code> and set <code>STENMONT_API_KEY</code> in your environment:</p>
      <Code name="mcpConfig" />
      <Note>Give an agent a key only on a machine you trust, and revoke the key in Settings when the work is done.</Note>
    </>
  );
}
