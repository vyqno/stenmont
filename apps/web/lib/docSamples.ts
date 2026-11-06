/**
 * Every code sample in the docs and in /llms-full.txt. They live here, not in the pages, so tests can run them against the
 * real packages and check that the text agrees everywhere. Change a sample here and the tests say what else must change.
 */
export type Sample = { lang: "bash" | "js" | "ts" | "tsx" | "json" | "python"; code: string };

export const API_URL = "https://api-staging.stenmont.com";
export const APP_URL = "https://app-staging.stenmont.com";
export const MCP_URL = "https://mcp-staging.stenmont.com/mcp";
export const X402_URL = "https://x402-staging.stenmont.com";

export const SAMPLES = {
  createInvoiceCurl: {
    lang: "bash",
    code: `curl -X POST ${API_URL}/v1/invoices \\
  -H "Authorization: Bearer $STENMONT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"amount":"25.00","successUrl":"https://shop.example/thanks","cancelUrl":"https://shop.example","metadata":{"order":"1042"}}'`,
  },

  createInvoiceFetch: {
    lang: "js",
    code: `// Server side only. The API key must never reach a browser.
async function createCheckout(order) {
  const res = await fetch(\`\${process.env.STENMONT_API_URL}/v1/invoices\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.STENMONT_API_KEY}\`,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: order.total, // dollars, as a string with at most 6 decimals, for example "25.00"
      successUrl: \`https://shop.example/orders/\${order.id}\`,
      cancelUrl: "https://shop.example/cart",
      metadata: { order: order.id },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error.code + ": " + body.error.message);
  return body.payUrl; // send the customer here
}`,
  },

  sdkCheckout: {
    lang: "ts",
    code: `import { Stenmont } from "@stenmont/sdk";

const stenmont = new Stenmont({
  apiKey: process.env.STENMONT_API_KEY!,
  baseUrl: process.env.STENMONT_API_URL, // ${API_URL} while testing; the default is production
});

export async function createCheckout(order: { id: string; total: string }) {
  const session = await stenmont.checkout.sessions.create({
    amount: order.total,
    successUrl: \`https://shop.example/orders/\${order.id}\`,
    cancelUrl: "https://shop.example/cart",
    metadata: { order: order.id },
  });
  return session.url; // send the customer here
}`,
  },

  sdkMore: {
    lang: "ts",
    code: `const invoice = await stenmont.invoices.create({ amount: "120.00", number: "INV-2026-001", dueDate: "2026-12-01T00:00:00.000Z" });
const found = await stenmont.invoices.get(invoice.id);
const open = await stenmont.invoices.list({ status: "open", limit: 25 });

// Starts a refund. Nothing moves until the business approves it with its passkey in the dashboard.
const refund = await stenmont.refunds.create({ invoiceId: invoice.id, amount: "5.00" });

const plan = await stenmont.subscriptions.create({ amount: "9.00", periodSeconds: 2_592_000, maxCharges: 12 });
// send the customer to plan.subscribeUrl

const csv = await stenmont.exports.paymentsCsv({ from: "2026-11-01", to: "2026-11-30", format: "quickbooks" });`,
  },

  sdkWebhook: {
    lang: "ts",
    code: `import { verifyWebhook } from "@stenmont/sdk";

export async function handleWebhook(rawBody: string, signatureHeader: string) {
  // Throws if the signature is wrong or the timestamp is more than 5 minutes old.
  const event = await verifyWebhook<{ invoice: { metadata: { order?: string } } }>(
    rawBody,
    signatureHeader,
    process.env.STENMONT_WEBHOOK_SECRET!,
  );
  if (event.type === "invoice.paid") {
    // Safe to run twice: an event can be delivered more than once.
    await markOrderPaid(event.data.invoice.metadata.order);
  }
}`,
  },

  verifyNode: {
    lang: "js",
    code: `const crypto = require("node:crypto");

// rawBody must be the exact request body text, before any JSON parsing.
function verifyStenmont(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !/^\\d+$/.test(t) || signatures.length === 0) throw new Error("malformed signature header");
  if (Math.abs(nowSeconds - Number(t)) > 300) throw new Error("timestamp outside the 5 minute window");
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const ok = signatures.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error("invalid signature");
  return JSON.parse(rawBody);
}`,
  },

  verifyPython: {
    lang: "python",
    code: `import hashlib, hmac, json, time

def verify_stenmont(raw_body: bytes, header: str, secret: str, now: float | None = None):
    """raw_body is the exact request body, before any JSON parsing."""
    parts = [p.strip() for p in header.split(",")]
    t = next((p[2:] for p in parts if p.startswith("t=")), None)
    signatures = [p[3:] for p in parts if p.startswith("v1=")]
    if not t or not t.isdigit() or not signatures:
        raise ValueError("malformed signature header")
    if abs((now if now is not None else time.time()) - int(t)) > 300:
        raise ValueError("timestamp outside the 5 minute window")
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(s, expected) for s in signatures):
        raise ValueError("invalid signature")
    return json.loads(raw_body)`,
  },

  webhookEvent: {
    lang: "json",
    code: `{
  "id": "evt_…",
  "type": "invoice.paid",
  "created": 1793960000,
  "livemode": false,
  "data": {
    "invoice": {
      "id": "0x4f1c…",
      "number": "INV-2026-001",
      "status": "paid",
      "amount": "25",
      "amountPaid": "25",
      "metadata": { "order": "1042" },
      "payUrl": "${APP_URL}/pay/0x4f1c…"
    },
    "payment": { "payer": "0x…", "value": "25", "txHash": "0x…", "blockNumber": 12345678 }
  }
}`,
  },

  reactButton: {
    lang: "tsx",
    code: `import { PayButton } from "@stenmont/react";

// Create the session on your server (see the SDK page), then pass its url to the button.
export function Checkout({ sessionUrl }: { sessionUrl: string }) {
  return <PayButton sessionUrl={sessionUrl}>Pay now</PayButton>;
}`,
  },

  mcpList: {
    lang: "bash",
    code: `curl -X POST ${MCP_URL} \\
  -H "Authorization: Bearer $STENMONT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  },

  mcpConfig: {
    lang: "json",
    code: `{
  "mcpServers": {
    "stenmont": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer \${STENMONT_API_KEY}" }
    }
  }
}`,
  },

  x402Server: {
    lang: "ts",
    code: `import { stenmontPaywall } from "@stenmont/x402";
import { Hono } from "hono";

const app = new Hono<{ Bindings: { PAY_TO: string; X402_FACILITATOR_URL: string } }>();

// Every call to /api/premium/* costs 0.01 USDT. Without a valid payment the answer is 402.
app.use("/api/premium/*", (c, next) =>
  stenmontPaywall({ amount: "0.01", payTo: c.env.PAY_TO, facilitatorUrl: c.env.X402_FACILITATOR_URL })(c, next),
);
app.get("/api/premium/quote", (c) => c.json({ price: "2.00" }));

export default app;`,
  },

  x402Agent: {
    lang: "ts",
    code: `import { createAgentFetch } from "@stenmont/agent";
import { privateKeyToAccount } from "viem/accounts";

// A fetch that pays 402 answers itself, inside limits checked before anything is signed.
const payingFetch = createAgentFetch({
  account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`),
  maxPerRequest: "0.05", // refuse any single price above this
  dailyLimit: "1.00", // refuse once a day's spend would pass this
  allowedHosts: ["shop-staging.stenmont.com"], // only these hosts may be paid
});

const res = await payingFetch("https://shop-staging.stenmont.com/api/premium/quote");`,
  },
} satisfies Record<string, Sample>;

export type SampleName = keyof typeof SAMPLES;
