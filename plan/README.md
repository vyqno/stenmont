# Stenmont build plan

One file per phase. Do phases in order; a phase starts only when the previous phase's **Done when** holds. Tick the `- [ ]` boxes as steps finish. After each task, add the commit line to `commits.md` (Claude never commits).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Test first, always.

## Status

| Phase | File | What it delivers | Tracks | Status |
|---|---|---|---|---|
| 0 | [00-prerequisites.md](00-prerequisites.md) | Accounts, tools, keys, funds, three spikes | none | not started |
| 1 | [01-foundation.md](01-foundation.md) | Repo, shared package, Foundry, API Worker + D1, CI | none | in progress (1.1 to 1.5 done, 1.6 CI left) |
| 2 | [02-get-paid.md](02-get-paid.md) | PaymentRouter, API, indexer, webhooks, first real USDT payment | Operate | done on staging (router, API, indexer, webhooks); production pending |
| 3 | [03-gasless.md](03-gasless.md) | Relayer with caps, passkey account, zero-crypto pay page | Scale | done on staging (passkey account, relayer with caps, pay page, drain tests); production pending |
| 4 | [04-plug-in.md](04-plug-in.md) | SDK, example store, dashboard, refunds, renewals, reminders, export | Operate | in progress (4.1 delegation and 4.3 SubscriptionManager done) |
| 5 | [05-identity.md](05-identity.md) | ENSv2 names and roles, World IDKit, World Agent Pass | ENS, World x2 | not started |
| 6 | [06-agents.md](06-agents.md) | x402 facilitator, agent pay client, finance MCP | Scale, World | not started |
| 7 | [07-financing.md](07-financing.md) | Investor allowlist, sell an invoice, settle, default | Tokenize | not started |
| 9 | [09-real-world.md](09-real-world.md) | Passkey onboarding, import, books that close themselves, agent interface (Code Mode), tokenization depth, treasury, review | all | after 4 to 7 |
| 8 | [08-ship.md](08-ship.md) | Seed data, video, README, feedback files, submission | all | not started |

**Strategy:** what makes this different and what Whitechain asked for is in [differentiation.md](differentiation.md).

**Contracts:** the full onchain suite and its test and audit standard is in [contracts.md](contracts.md). Read it before Phases 2, 3, 5 and 7.

Cut line if time runs short, in order of what to keep: 1, 2, 3, 5 (minimum), 8, then 4, then 7, then 6. Never cut 8.

## Architecture in one screen

```
contracts/            Foundry: PaymentRouter, SubscriptionManager, PasskeyAccount(+Factory), InvestorRegistry, InvoiceClaim
packages/shared       chains, USDT, money, EIP-712 builders, ids        (used by everything)
packages/sdk          @stenmont/sdk      server client (invoices, checkout, refunds, webhook verify)
packages/react        @stenmont/react    <PayButton/> / <Checkout/>
packages/agent        @stenmont/agent    agent pay client with limits
services/api          Hono Worker: REST API, relayer (Durable Object), indexer (Cron), webhooks (Queue), email
services/facilitator  Hono Worker: x402 verify/settle on Whitechain
services/mcp          MCP Worker: finance agent tools
apps/web              Next.js 16 on Cloudflare (OpenNext): dashboard, pay page, investor portal, landing
apps/example-store    separate demo shop that adds Stenmont in about 20 lines
```

## Decisions (and why)

| Decision | Why |
|---|---|
| **Cloudflare D1 (SQLite) + Drizzle**, not Postgres/Neon | One vendor, no connection strings, no Hyperdrive, no extra account; a Workers binding. Trade-offs we accept: money columns are TEXT holding base units (converted to `bigint` in code), no row-level security so every query is scoped by `merchant_id` in one helper that tests cover. |
| Relayer is a **Durable Object** | One writer per relayer key means no nonce races under concurrent payments. |
| Indexer is a **Cron Trigger** polling `getLogs` | Workers cannot hold a long-lived chain listener. |
| Webhooks go through a **Queue** with retries | At-least-once delivery with backoff; receivers dedupe on event id. |
| Dashboard login is an **email magic link** (Cloudflare Email Sending) | No passwords, nothing extra to build; World ID guards the risky actions instead. |
| Payer and merchant accounts are **passkey smart accounts** | No seed phrase; works with USDT's ERC-1271 signature check. |
| **Foundry** for contracts | Fuzz and invariant tests for money code, fork tests, `forge script` deploys. |

## Environments and secrets

- Every change goes local, then staging (`api-staging.stenmont.com`, `app-staging.stenmont.com`), then production (`api.stenmont.com`, `app.stenmont.com`). Production only on an explicit go-ahead. The production deploy scripts refuse to run without `STENMONT_CONFIRM_PRODUCTION=yes`.
- Each Worker's `wrangler.jsonc` has three blocks: top level (local only), `env.staging`, `env.production`, each with its own name, route and D1 database.
- Secrets live in Cloudflare (`wrangler secret`), never in code, config or git. `.env` is a local paste area only; `.env.example` lists names only and how each is stored.

## Global constraints (every phase)

- Only the official USDT on Whitechain Sepolia: `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals. Chain id `1874`, RPC `https://rpc.testnet.whitechain.io`, explorer `https://explorer.testnet.whitechain.io`.
- Contracts never hold customer money: router USDT balance is 0 after every call.
- Latest stable versions, checked live when a phase starts (`npm view`, GitHub releases). Node 26.13.0 LTS, pnpm 12, TypeScript 7, Foundry 1.9.0, Solidity 0.8.38, Next.js 16.
- No secrets in the repo; `.env` and `wrangler secret` only. Test keys only.
- Every money-moving call is idempotent and writes an `audit_log` row.
- Money in code is `bigint` of USDT base units (6 dp); in D1 it is a decimal TEXT string.
