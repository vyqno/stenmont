# Stenmont

**Commerce and finance for businesses that run on stablecoins.**

*The agentic business kit.*

Stenmont brings selling, USDT payments, books and working capital into one platform. A financial agent can install the checkout through Connect and help operate the business within explicit permissions; people retain control of money actions.

## The business loop

- **Sell.** Manage products, variants and orders; use a hosted storefront or connect an existing site through a coding-agent prompt, OAuth MCP or the SDK.
- **Get paid.** Checkout, payment links, invoices and subscriptions settle in USDT. Payers bring their own funds; the merchant's gas tank covers relayed network fees within limits.
- **Close the books.** Follow receipts, refunds and reconciliation; export accounting records and verify signed period bundles. An onchain ledger anchor is not deployed.
- **Get funded.** Eligible merchants can offer unpaid receivables to eligible investors. Funding and repayment are separate actions; neither investor liquidity nor buyer payment is guaranteed.

The same account, records and agent permissions connect the loop. The current build runs on staging with test USDT; the evidence below distinguishes live acceptance from implementation.

## Who it's for

Online stores, creators, service businesses, suppliers and SaaS teams that want to sell and operate in stablecoins. Merchants use a passkey and dashboard without managing a seed phrase; customers already hold USDT. Developers and agents get the same commerce foundation through APIs, SDK components and MCP.

## Built on

| | What it does |
|---|---|
| **Whitechain** | USDT settlement, gasless payments, invoice financing with the rules in the contract |
| **World ID** | One person, one business; buyer and supplier are different people; human approval for risky agent actions |
| **ENSv2** | Business and expiring agent names, per-record permissions and a payout that can be locked; invoice wildcard resolution is not supported by the deployed resolver |

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

The router forwards USDT along its configured payment path. InvoiceClaim retains reserves and any deferred payout liabilities until settlement or withdrawal. The merchant pays the gas for their customers (a per-merchant gas tank), and the relayer refuses anything that is not a simulated, capped, single-use authorisation. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

Needs Node 26.13.0 or newer (see `.nvmrc`) and pnpm 12.16.1. Foundry 1.9.0 is needed only for Solidity checks. The workspace explicitly allows native build scripts for `esbuild` and `workerd`; other dependency scripts stay blocked.

Run these from a fresh clone without any `.env` or Cloudflare credentials:

```bash
pnpm install --frozen-lockfile
VITEST_MAX_WORKERS=1 pnpm -r --workspace-concurrency=1 test
pnpm -r --workspace-concurrency=1 lint
pnpm --filter @stenmont/web typecheck
pnpm --filter @stenmont/web build:cf
pnpm --filter @stenmont/scripts seed-demo  # dry-run only: no network or writes
```

The tests use local fixtures and SQLite; passing them does not prove a live payment or provider integration. Web builds need no font download: the browser loads the existing Adobe web project at runtime.

For local development, use separate terminals:

```bash
pnpm --filter @stenmont/api db:migrate:local
pnpm --filter @stenmont/api dev           # API on localhost:8787
pnpm --filter @stenmont/web dev           # web on localhost:3000
```

Real chain operations require the appropriate testnet credentials and payer-owned USDT. Worker secrets belong in Cloudflare per environment; root `.env` is not required by the checks above and is never committed. Staging deployments are coordinated by one lead; production deployment and npm publication remain outside the current authorization.

Contract checks (no broadcasts):

```bash
cd contracts
forge soldeer install
forge fmt --check
forge build
forge test
```

See [migration policy](docs/MIGRATIONS.md) before using drizzle-kit, and [staging dataset preparation](docs/SEED.md) before creating demo records.

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

- A browser using an already-funded wallet paid 1.00 test USDT on the current router ([transaction](https://explorer.testnet.whitechain.io/tx/0x918025b8e3038718d216ea2228636c5883c18749f4f5619e1084d53b9878164c)); evidence is recorded in [combined staging acceptance](docs/COMBINED-STAGING-ACCEPTANCE.md). No wallet was funded for that run.
- A customer with zero WBT paid 2.50 USDT for an invoice the API created ([transaction](https://explorer.testnet.whitechain.io/tx/0xa574d203ded29f21fadec46cceabe269551e43c82caadf08d29d9487cc817a0d); this was on the earlier staging router, since retired).
- An AI agent paid 0.01 USDT for an API call through our x402 facilitator ([transaction](https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91)).

## Why onchain stablecoin settlement

A card or bank rail cannot do three things here. It cannot let a payer with no account and no gas pay with one tap and still leave a public, checkable receipt. It cannot enforce a refund limit, a subscription cap or an investor allowlist in code that neither side can bend. And it cannot let a software agent hold spending power that is limited by the money's own rules instead of by trust in the agent. Each of these is a contract rule here, not a policy.

## Current limitations

- Testnet only. Production is not deployed, and contract ownership is a single wallet until a multisig is set up.
- Linked verified email can recover read-only dashboard access. It cannot replace a lost passkey controlling the existing payout account; payout recovery needs a separately approved contract design.
- The contract suite has had internal review and static analysis but no external audit.
- World approvals and the investor allowlist need a real person with World App; the World simulator is a single fixed identity.
- The lowercase wordmark uses All Round Gothic Regular 400; supporting headings/body use Neue Haas Grotesk Display/Text from the existing Adobe project. No font binaries or trial files are distributed in this repository.

## Implementation and live-proof boundaries

- Router v2, acknowledgement and ledger-anchor source are inactive candidates; addresses and active ABI imports remain v1. Deployment requires approval and the gates in [ROUTER-V2.md](docs/ROUTER-V2.md).
- Finance chat defaults off and requires a provider key; adapter fixtures are not a real model call. A2A discovery is opt-in and signed fact observations require recorded proof provenance.
- Collections queue entries are drafts/decisions, not sent messages. B2B replacement plans require cancellation of the original router invoice and signatures for every agreement.
- Books signs recorded source membership and ledger lines; a Merkle proof does not prove completeness of offchain income. Anchoring is unavailable until a registry is separately approved and configured.
- The current live-proof status belongs in the dated [combined staging acceptance](docs/COMBINED-STAGING-ACCEPTANCE.md) and later lead reports; do not infer it from this feature list.

## Track evidence and remaining proof

| Track | Evidence recorded | Boundary still open |
|---|---|---|
| Whitechain Operate | A separate demo shop completed a 1.00 test-USDT checkout, signed webhook and paid order; Connect reached 4/4. [Payment transaction](https://explorer.testnet.whitechain.io/tx/0xe8c96bc95001abd0aedb148bd869d82fb32db5800496c7a3568ea4120d8c34e3). Books produced a real signed two-line interim bundle verified offline; tampering was rejected. | No deployed ledger anchor; no Razorpay checkout acceptance while test credentials remain unset. |
| Whitechain Tokenize | The earlier direct invoice lifecycle settled onchain; [financing walkthrough](docs/FINANCING_WALKTHROUGH.md) describes the flow. | Dashboard “Sell this invoice” through claim timeline and public certificate still needs the real World-gated run. Router v2 is not deployed. |
| Whitechain Scale | Prompt-installed checkout and real OAuth MCP consent, tool discovery and scoped invoice read; [install acceptance](docs/INSTALL-ACCEPTANCE.md). | One isolated store is evidence, not proof for every merchant platform. A successful Cloud-backed Gemini reply is still pending. |
| World IDKit / Agent Pass | Verification and approval paths are implemented; simulator and fixture results are distinct from a person's proof. | Real World sign-in, investor eligibility and the real approval/denial journey remain owner-assisted acceptance. |
| ENSv2 | Real Sepolia business name `fieldwork-install-20261106.stenmont.eth`, directory/profile records, a scoped grant and a one-day agent name. [Resolver support boundaries](docs/WAVE2-W15.md). | Expiry lifecycle readback is waiting; invoice wildcard resolution, non-transferable team names and shared-policy aliasing are not established on the deployed resolver. |
| Continuity | Started from scratch during the hackathon. | Not targeted: there is no pre-hackathon baseline. |

## More

Security: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Decisions: [docs/adr](docs/adr). Demo shot list: [DEMO.md](DEMO.md).

## Licence

Apache-2.0, see [LICENSE](LICENSE).
