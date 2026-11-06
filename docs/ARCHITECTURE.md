# Architecture

Stenmont lets a business get paid in stablecoins (the official USDT on Whitechain) without its customers needing a wallet, gas or any crypto knowledge, and then do more with the invoice: refund it, bill it again, export it for the accountant, sell it for cash today, or hand a limited budget to an AI agent. This page explains how the pieces fit. Everything runs on the **Whitechain Sepolia testnet (chain 1874)** with test tokens; nothing here holds real money.

## The pieces

```
Customer browser ──passkey──► apps/web (Next.js on Cloudflare)
                                │  pay page, merchant dashboard, investor page
                                ▼
Merchant server ──API key──► services/api (Hono Worker)
  @stenmont/sdk               │  invoices, refunds, subscriptions, export, ENS names, World checks
                              │  D1 (SQLite) · Queue (webhooks) · Cron (indexer, renewals, reminders)
                              ▼
                     Durable Object sender  ──►  Whitechain Sepolia
                     (one writer, no nonce races)   PaymentRouter · SubscriptionManager
                                                    PasskeyAccount(+Factory) · InvoiceClaim
                                                    InvestorRegistry · ReputationRegistry
                              ▲
AI agent ──x402──► services/facilitator ── verifies and settles payments (EIP-3009)
  @stenmont/agent  @stenmont/x402 (paywall middleware for the merchant's API)

ENS (Sepolia): stenmont.eth ─► business names ─► agent names, each with its own resolver
World: IDKit (one person, one business) · Agent Pass (a person approves risky actions)
```

| Folder | What it is |
|---|---|
| `contracts/` | Foundry project: the onchain rules. |
| `services/api` | The REST API, the relayer, the indexer, webhooks, ENS and World integration. |
| `services/facilitator` | x402 facilitator: verifies and settles agent payments. |
| `apps/web` | Pay page, subscribe page, merchant dashboard, sign-in. |
| `apps/example-store` | A separate demo shop that adds Stenmont in about 10 lines. |
| `packages/shared` | Types, EIP-712 builders, ids, generated ABIs and addresses (one source of truth). |
| `packages/sdk`, `react`, `x402`, `agent` | The developer kit. |

## How a payment works (no wallet, no gas)

1. The merchant (or its server through the SDK) creates an invoice. The API creates it onchain through the router's delegation, so the API never holds a merchant key.
2. The customer opens the pay page and taps once. A **passkey** (Face ID, fingerprint, device PIN) signs a USDT `receiveWithAuthorization` that is bound to this invoice and this amount. The customer's smart account is created in the same transaction the first time.
3. The relayer simulates the call, reserves the worst-case gas from the **merchant's gas tank**, sends it through the single Durable Object sender, then charges the real cost. The customer never holds the gas token.
4. The router moves the money from the customer straight to the merchant's payout. It never keeps customer funds (its USDT balance is zero after every call).
5. The indexer (every minute) records the event, updates the invoice, and sends a signed webhook.

**What stops draining the relayer:** the signature is bound to one invoice and amount and the token accepts it once; every call is simulated first so bad requests cost nothing; per-payer and per-IP rate limits; a daily gas cap per merchant; reservations are atomic so concurrent requests cannot overspend; the relayer refuses to work below a floor.

## Identity (ENS and World)

- Each business gets `label.stenmont.eth` with its **own resolver**, owned by its payout account. Permissions in the deployed ENSv2 resolver belong to a record key, so a name that needs its own permissions needs its own resolver. A finance member can be limited to the profile record only, and the **payout can be locked permanently**: the platform's registrar gives up its rights over that record and nobody can change it.
- Invoices can be paid to the business's own ENS name, resolved when the invoice is created.
- Each AI agent is a name under the business (`billing-bot.acme.stenmont.eth`) with its own resolver, a policy record (limits and scopes), an expiry, and the right to edit only its own `agent-context` record.
- World ID (IDKit, Proof of Human) enforces one person per business. World Agent Pass is a fresh sign-in a person completes to approve a risky action (a large refund, a large agent limit); the platform then signs the router's approval for exactly that action.

## Getting paid early

A verified business can list an invoice. An allowlisted investor (World-verified, attested by the platform) buys the claim at a discount; the merchant receives the price minus a reserve at once. When the customer pays the invoice, the router's payout hook sends the money to the claim, which pays the holder; at full payment the reserve is released to the merchant. After the due date plus a grace period anyone can mark a default and the reserve goes to the investor. Transfers of the claim are restricted onchain to allowlisted holders.

## Trust model (read this before relying on it)

- Contracts never hold customer funds. Roles: owner and guardian are one deployer wallet today; the plan is a multisig before real value.
- The shared relayer is a delegated invoice creator for every merchant that enabled it; the API pins payouts, the contract does not.
- A lost passkey means a lost account until recovery (a second passkey) is built.
- The platform operates one attester key (for investor and large-refund approvals) and one ENS registrar key; both are Cloudflare secrets.
- Everything is testnet-only. See `SECURITY.md` for the open items from the independent review.

## Environments

`local` (top-level block in each `wrangler.jsonc`), `staging` (the public testnet deployment), `production` (reserved for mainnet; nothing deployed). Secrets live only in Cloudflare (`wrangler secret`), per environment. Deploy scripts for production refuse to run without an explicit confirmation variable.
