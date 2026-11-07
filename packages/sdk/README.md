# @vyqno/sdk

Server SDK for [Stenmont](https://stenmont.com): invoices, checkout sessions, refunds, subscriptions, CSV export and webhook verification, paid in USDT on Whitechain.

```ts
import { Stenmont, verifyWebhook } from "@vyqno/sdk";

const stenmont = new Stenmont({
  apiKey: process.env.STENMONT_API_KEY!,
  baseUrl: "https://api-staging.stenmont.com", // the public testnet; the default is production
});

// Send the customer to Stenmont's pay page; they come back to successUrl.
const session = await stenmont.checkout.sessions.create({
  amount: "25.00",
  successUrl: "https://shop.example/thanks",
  cancelUrl: "https://shop.example",
  metadata: { order: "1042" },
});
// redirect to session.url

// Webhook handler: reject anything whose signature does not verify.
const event = await verifyWebhook(rawBody, signatureHeader, process.env.STENMONT_WEBHOOK_SECRET!);
```

Testnet only for now (Whitechain Sepolia, test USDT). Apache-2.0.
