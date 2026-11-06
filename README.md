# Stenmont

**Commerce and finance for businesses that run on stablecoins.**

*The agentic business kit.*

Stenmont brings selling, USDT payments, books and working capital into one platform. A financial agent can install the checkout through Connect and help operate the business within explicit permissions; people retain control of money actions.

Built from scratch for ETHGlobal Mumbai 2026. Staging uses Whitechain test network 1874 and official test USDT; ENS uses Ethereum Sepolia. No real money, merchant traction or production deployment is claimed.

| Staging entry | Address |
|---|---|
| Web app and docs | https://app-staging.stenmont.com / [docs](https://app-staging.stenmont.com/docs) |
| API | https://api-staging.stenmont.com |
| Separate demo shop | https://demo-shop-staging.stenmont.com |
| OAuth MCP | https://mcp-staging.stenmont.com/mcp |
| Agent instructions | [llms.txt](https://app-staging.stenmont.com/llms.txt) |

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

## Deployed on Whitechain test network (chain 1874, staging)

Router v2 is deployed and verified. Its dashboard financing acceptance remains open. The deployment manifest records exact addresses, blocks, receipts and status: [1874.json](contracts/deployments/1874.json). Existing v1 invoices retain their original router; old addresses are retired for new invoices, not erased.

| V2 contract | Address | Deployment |
|---|---|---|
| PaymentRouterV2 | [0xda4dfa02b95fd14bfac657535cbcac7f339bd8e6](https://explorer.testnet.whitechain.io/address/0xda4dfa02b95fd14bfac657535cbcac7f339bd8e6) | [receipt](https://explorer.testnet.whitechain.io/tx/0xbcc8acb301a5f95ee1208754b7ad9bacb4ec82b4baf4e7ebd57a3953fc6d1fc5) |
| InvoiceClaimV2 | [0xd994a18962dda95aa23ba2d25ba9cc7c8addaf3d](https://explorer.testnet.whitechain.io/address/0xd994a18962dda95aa23ba2d25ba9cc7c8addaf3d) | [receipt](https://explorer.testnet.whitechain.io/tx/0x96298c840a064a2cfc82022943e1ae2b7bbd4896f978e29b62f9e0226f5fb716) |
| InvoiceAck | [0xfeccfc30714bb3972a5cffe02371f475570aa011](https://explorer.testnet.whitechain.io/address/0xfeccfc30714bb3972a5cffe02371f475570aa011) | [receipt](https://explorer.testnet.whitechain.io/tx/0x0fe16e8a1691c28f36290e623e822dabb0fdd261b03c8c0359b31ccdd9d3ed48) |
| InvestorRegistry | [0x03b5803bb1b65401f8e7130a044e46b00aa0abd6](https://explorer.testnet.whitechain.io/address/0x03b5803bb1b65401f8e7130a044e46b00aa0abd6) | [receipt](https://explorer.testnet.whitechain.io/tx/0xeb53260991072f3b98333c7db56bd8c26397ccaaae3d51be5fa007b0cdcfdb75) |
| ReputationRegistryV2 | [0xffee131f70576cd8bd7742f1a9e93276d1821e05](https://explorer.testnet.whitechain.io/address/0xffee131f70576cd8bd7742f1a9e93276d1821e05) | [receipt](https://explorer.testnet.whitechain.io/tx/0xc1de55d76eca835d6ec03b8d452f570ec6f250a63f429cdd5ae8ddcfe6e8bc8e) |

The newly deployed v2 SubscriptionManager is **inactive**. Subscriptions retain the v1 manager `0x0e22748d63717D51eE8DFa5A62413A11dda981cF`; the existing PasskeyAccountFactory remains `0x5101c37647581c81b462436af2D7ac8ccD08D33A`. [Version routing](docs/API-VERSION-ROUTING.md) and [v2 acceptance](docs/V2-STAGING-ACCEPTANCE.md) describe the cutover.

## Real payments in the official USDT

- A browser using an already-funded wallet paid 1.00 test USDT on the now-legacy v1 router ([transaction](https://explorer.testnet.whitechain.io/tx/0x918025b8e3038718d216ea2228636c5883c18749f4f5619e1084d53b9878164c)); evidence is recorded in [combined staging acceptance](docs/COMBINED-STAGING-ACCEPTANCE.md). No wallet was funded for that run.
- A customer with zero WBT paid 2.50 USDT for an invoice the API created ([transaction](https://explorer.testnet.whitechain.io/tx/0xa574d203ded29f21fadec46cceabe269551e43c82caadf08d29d9487cc817a0d); this was on the earlier staging router, since retired).
- An AI agent paid 0.01 USDT for an API call through our x402 facilitator ([transaction](https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91)).

### V2 live regression (partial)

- A named buyer paid **0.098 test USDT** on a 0.10 invoice with a 2% early-payment discount: [receipt](https://explorer.testnet.whitechain.io/tx/0x3c1591ffdade2c192d5a9cf6763b1ccb5d6c4e86fbdc39cb9a34219c84589dbe). Wrong-payer, tampered payout and expired authorization requests were refused before relay submission.
- A buyer acknowledgement of an operator-controlled synthetic test delivery reduced the indicative quote from **4.80% to 3.80%**: [receipt](https://explorer.testnet.whitechain.io/tx/0x213838bf9b657387c61eff531a72dc822ea26b24d5c5f8aa70726fac54c75d70). This is neither a payment guarantee nor proof of independent humans.
- The Shopify bridge session recorded a **0.117059 test-USDT** payment and signed-webhook completion of order **#1001**: [receipt](https://explorer.testnet.whitechain.io/tx/0xe0f73087b7d1b4b7a492222afd5fe182c51ab0f81a7c5e5657594b89d6250c41). Its INR conversion used a labelled demo rate of 85 INR/USDT; the manual method is not a production Shopify gateway. The later direct-order total/currency guard is merged and locally tested only: the live bridge Worker has deliberately not been redeployed. Shopify admin-browser installation and refunds are not live acceptance claims. [Bridge guide](docs/SHOPIFY_BRIDGE.md).

Earlier financing evidence is the **legacy v1 direct-script lifecycle**, not a v2 dashboard certificate. Its investor allowlist used a labelled attester shortcut instead of a real World proof: [run and transactions](docs/TOKENIZATION-STAGING-RUN.md). Do not repeat it as a substitute for the pending dashboard journey.

## Why onchain stablecoin settlement on Whitechain

Whitechain lets the payer sign a single-use USDT authorization while a relayer sends the transaction and pays WBT gas. The same public settlement record can drive the order webhook, receipt and books. Contract-enforced payout binding, refund approval, subscription caps and investor restrictions make the money rules independently inspectable; this does not guarantee payment, legal enforceability or privacy.

## How gas works

The merchant's gas tank accounts for eligible relayed network fees; the relayer's funded WBT wallet sends transactions. Simulation, single-use authorization, request limits, daily caps and atomic reservations bound that service. A tank balance is not USDT held for customers. See [relayer accounting and recovery](docs/RELAYER.md) for covered paths and limitations. Payers and investors bring their own USDT; Stenmont does not fund their accounts, run a faucet for this flow, sell USDT or operate an on-ramp.

## Why Proof of Human is the minimum credential

The implemented questions concern distinct humans: business enrollment, buyer/supplier checks where verified business identities are known, and investor eligibility. Server-verified nullifiers support uniqueness checks without requesting passport facts for those questions. A human proof is not a KYC, sanctions or credit assessment; document verification remains a sandbox adapter. Simulator success and duplicate-person refusal are earlier staging evidence, while the real World session remains held. See [verification boundaries](docs/VERIFICATION.md).

## Privacy

USDT sender/receiver addresses, amounts and transaction times are public. Public names can link an address to a business. Offchain invoice/customer records and private receipt tokens must not be published. Merkle proofs establish membership in a signed snapshot, not completeness of a business's income. This build does not offer confidential settlement.

## Current limitations

- Testnet only. Production is not deployed, and contract ownership is a single wallet until a multisig is set up.
- Linked verified email can recover read-only dashboard access. It cannot replace a lost passkey controlling the existing payout account; payout recovery needs a separately approved contract design.
- The contract suite has had internal review and static analysis but no external audit.
- World approvals and the investor allowlist need a real person with World App; the World simulator is a single fixed identity.
- The lowercase wordmark uses All Round Gothic Regular 400; supporting headings/body use Neue Haas Grotesk Display/Text from the existing Adobe project. No font binaries or trial files are distributed in this repository.

## Implementation and live-proof boundaries

- Router v2 and buyer acknowledgement are deployed on testnet; named-buyer discount and acknowledgement receipts are recorded below. The full v2 dashboard financing lifecycle is not completed. Ledger anchoring is inactive and separately gated; see [ROUTER-V2.md](docs/ROUTER-V2.md).
- Gemini live generation is held: the Vertex API request returned a missing prediction-permission error; no successful model reply is claimed. Provider fixtures are not a real model call. A2A discovery is opt-in and signed fact observations require recorded proof provenance.
- Collections queue entries are drafts/decisions, not sent messages. B2B replacement plans require cancellation of the original router invoice and signatures for every agreement.
- Books signs recorded source membership and ledger lines; a Merkle proof does not prove completeness of offchain income. Anchoring is unavailable until a registry is separately approved and configured.
- The current live-proof status belongs in the dated [combined staging acceptance](docs/COMBINED-STAGING-ACCEPTANCE.md) and later lead reports; do not infer it from this feature list.

## Track evidence and remaining proof

| Track | Evidence recorded | Boundary still open |
|---|---|---|
| Whitechain Operate | A separate demo shop completed a 1.00 test-USDT checkout, signed webhook and paid order; Connect reached 4/4. [Payment transaction](https://explorer.testnet.whitechain.io/tx/0xe8c96bc95001abd0aedb148bd869d82fb32db5800496c7a3568ea4120d8c34e3). Books produced a real signed two-line interim bundle verified offline; tampering was rejected. | No deployed ledger anchor; no Razorpay checkout acceptance while test credentials remain unset. |
| Whitechain Tokenize | The earlier direct invoice lifecycle settled onchain; [financing walkthrough](docs/FINANCING_WALKTHROUGH.md) describes the flow. | Dashboard “Sell this invoice” through claim timeline and public certificate still needs the real World-gated run. Router v2 is deployed; the new full dashboard lifecycle is not yet proven. |
| Whitechain Scale | Prompt-installed checkout and real OAuth MCP consent, tool discovery and scoped invoice read; [install acceptance](docs/INSTALL-ACCEPTANCE.md). | One isolated store is evidence, not proof for every merchant platform. A successful Cloud-backed Gemini reply is still pending. |
| World IDKit / Agent Pass | Verification and approval paths are implemented; simulator and fixture results are distinct from a person's proof. | Real World sign-in, investor eligibility and the real approval/denial journey remain owner-assisted acceptance. |
| ENSv2 | Real Sepolia business name `fieldwork-install-20261106.stenmont.eth`, directory records and a profile-only role grant, plus a one-day agent name. [Resolver support boundaries](docs/WAVE2-W15.md). | Revocation was read back; natural-expiry lifecycle readback is waiting; invoice wildcard resolution, non-transferable team names and shared-policy aliasing are not established on the deployed resolver. |
| Continuity | Started from scratch during the hackathon. | Not targeted: there is no pre-hackathon baseline. |

## Before and during the hackathon

Stenmont began from scratch during the hackathon; third-party dependencies and scaffolding are not earlier Stenmont product work. We are **not entering Continuity** because there is no pre-hackathon product baseline. Source history is preserved with real dates. Publication of the working branch and npm packages remains the founder's decision; the SDK and React packages are not claimed published.

The [track checklist](docs/TRACK-CHECKLIST.md) separates implementation, historical live proof and owner-assisted acceptance. The [World run sheet](docs/WORLD-SESSION-RUN-SHEET.md) is prepared, not executed. The [Builders Program draft](docs/BUILDERS_PROGRAM.md) is not a submitted application.

## Third-party software

Dependencies include OpenZeppelin Contracts, forge-std/Foundry, Hono, Drizzle ORM, viem, zod, Next.js, OpenNext for Cloudflare, World IDKit, Playwright and Vitest. Versions are pinned in workspace manifests and lockfiles. No trial font files or third-party reference artwork are distributed.

## More

Security: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Decisions: [docs/adr](docs/adr). Demo shot list: [DEMO.md](DEMO.md).

## Licence

Apache-2.0, see [LICENSE](LICENSE).
