# Stenmont

**Cross-border business payments, settled in seconds, with invoices you can finance.**

## The problem

Businesses that bill across borders wait days to get paid and lose a cut along the way. Once the money lands, someone still types it into the books by hand. Then they wait 30 to 90 days on unpaid invoices just to have cash to keep running.

## What Stenmont does

- **Get paid.** Invoices, checkout and payment links. Clients pay in USDT with a passkey: no wallet, no gas, settled in about a second.
- **Everything after.** Receipts, refunds, renewals, reminders, webhooks and an export your accountant can use.
- **Plug in.** About 20 lines with the SDK, or one prompt to your AI agent.
- **Get paid early.** Every payment builds the payer's record. Businesses use that record to sell invoices, fund orders in stages, or join a buyer's supplier programme.
- **Agents with limits.** AI agents handle the routine work. A person approves anything risky.

## Built on

| | What it does |
|---|---|
| **Whitechain** | USDT settlement, gasless payments, invoice financing with the rules in the contract |
| **World ID** | One person, one business; buyer and supplier are different people; human approval for risky agent actions |
| **ENSv2** | A name for every business and agent, a payout that can be locked, and invoices that resolve to whoever owns them now |

## Who it's for

Small and mid-size businesses that bill clients in other countries or across platforms: studios, exporters, suppliers and online stores.

## How it works

```
 customer (passkey, no wallet)        merchant (passkey, dashboard / SDK / MCP)
          |                                        |
          v                                        v
   pay page ---------> API Worker (Hono) <---- create invoice, refund, export
                          |   |   |
        relayer (Durable Object, caps)   indexer (cron)   webhooks (queue)
                          |                    |
                          v                    v
        Whitechain Sepolia (1874): PaymentRouter, SubscriptionManager,
        PasskeyAccount(+Factory), InvoiceClaim, InvestorRegistry, ReputationRegistry
                          |
              official USDT (EIP-3009 / permit, ERC-1271 for passkey accounts)
```

The contracts never hold customer money: the router's USDT balance is zero after every call. The merchant pays the gas for their customers (a per-merchant gas tank), and the relayer refuses anything that is not a simulated, capped, single-use authorisation. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

Needs Node 26.13.0 (`.nvmrc`), pnpm 12 and Foundry 1.9.0.

```bash
pnpm install
cp .env.example .env            # names only; fill in your own test keys
pnpm -r test                    # TypeScript tests (API, shared, SDK, x402, MCP, web)
cd contracts && forge test      # contract tests (unit, fuzz, invariant)
cd ../services/api && pnpm dev  # local API on :8787
cd ../../apps/web && pnpm dev   # web app on :3000
```

Secrets live in Cloudflare (`wrangler secret`) per environment; `.env` is a local paste area and is never committed. Order of work is local, then staging, then production.

## Deployed on Whitechain Sepolia (chain 1874, staging)

| Contract | Address |
|---|---|
| PaymentRouter | [0x4c32…dC0](https://explorer.testnet.whitechain.io/address/0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0) |
| SubscriptionManager | [0x0e22…1cF](https://explorer.testnet.whitechain.io/address/0x0e22748d63717D51eE8DFa5A62413A11dda981cF) |
| PasskeyAccountFactory | [0x5101…33A](https://explorer.testnet.whitechain.io/address/0x5101c37647581c81b462436af2D7ac8ccD08D33A) |
| InvestorRegistry | [0x6B84…8fa](https://explorer.testnet.whitechain.io/address/0x6B8490a893C860888f65ce410b0b287CA1c9B8fa) |
| InvoiceClaim | [0x2EB9…914](https://explorer.testnet.whitechain.io/address/0x2EB9aaF14A2d729BC3F185A144571fCd23454914) |
| ReputationRegistry | [0x7511…Ed5](https://explorer.testnet.whitechain.io/address/0x751165C1E587637aF6EC0ff91b87Fa7Bd08a9ed5) |

All are verified on the explorer. The single source of truth is `contracts/deployments/1874.json`; the shared package is generated from it.

## Real payments in the official USDT

- A customer with zero WBT paid 2.50 USDT for an invoice the API created ([transaction](https://explorer.testnet.whitechain.io/tx/0xa574d203ded29f21fadec46cceabe269551e43c82caadf08d29d9487cc817a0d); this was on the earlier staging router, since retired).
- An AI agent paid 0.01 USDT for an API call through our x402 facilitator ([transaction](https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91)).

## Why onchain stablecoin settlement

A card or bank rail cannot do three things here. It cannot let a payer with no account and no gas pay with one tap and still leave a public, checkable receipt. It cannot enforce a refund limit, a subscription cap or an investor allowlist in code that neither side can bend. And it cannot let a software agent hold spending power that is limited by the money's own rules instead of by trust in the agent. Each of these is a contract rule here, not a policy.

## Current limitations

- Testnet only. Production is not deployed, and contract ownership is a single wallet until a multisig is set up.
- A lost passkey loses the account; recovery with a second passkey is planned.
- The contract suite has had internal review and static analysis but no external audit.
- World approvals and the investor allowlist need a real person with World App; the World simulator is a single fixed identity.
- Fonts are Adobe Fonts trial or project licences until the web licences are bought.

## More

Security: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Decisions: [docs/adr](docs/adr). Demo shot list: [DEMO.md](DEMO.md).
