# Stenmont

**The business payments kit for Whitechain: get paid in USDT with a passkey, then refund, renew, export, finance and automate, without your customers or your team ever touching crypto.**

Built for ETHGlobal Mumbai 2026 on the Whitechain Sepolia testnet (chain 1874). Test tokens only, no real money.

| Live (staging) | Address |
|---|---|
| Web app (dashboard, pay page, investor market) | https://app-staging.stenmont.com |
| API | https://api-staging.stenmont.com |
| Example shop that adds Stenmont in 10 lines | https://shop-staging.stenmont.com |
| MCP server for AI agents (OAuth 2.1) | https://mcp-staging.stenmont.com/mcp |
| x402 facilitator we run | https://x402-staging.stenmont.com |
| Docs for people and agents | https://app-staging.stenmont.com/docs, [`llms.txt`](https://app-staging.stenmont.com/llms.txt) |

Where to look first: the [tracks-to-evidence table](#tracks-to-evidence) says, for every sponsor requirement, what proves it and what is not yet proven. The full audit is in [docs/TRACK-CHECKLIST.md](docs/TRACK-CHECKLIST.md). The demo shot list is [DEMO.md](DEMO.md).

## The problem

Businesses that bill across borders wait days to get paid and lose a cut along the way. Once the money lands, someone still types it into the books by hand. Then they wait 30 to 90 days on unpaid invoices just to have cash to keep running.

## What Stenmont does

- **Get paid.** Invoices, payment links, a hosted checkout and subscriptions. The customer pays USDT with a passkey: no wallet app, no gas, settled in about a second. The merchant never sees a wallet either: a smart account is created at sign-up.
- **Everything after the payment.** Receipts with explorer links, full and partial refunds, renewals, due-date reminders, signed webhooks and an accountant export (generic CSV and QuickBooks layout).
- **Plug in.** About 10 lines with the SDK ([`apps/example-store/INTEGRATION.md`](apps/example-store/INTEGRATION.md)), a React `<PayButton/>`, or one prompt pasted into the AI agent that already runs the site (the Connect page in the dashboard, `llms.txt`, and an OAuth-protected MCP server).
- **Get paid early.** A verified business can sell an unpaid invoice to an allowlisted investor at a discount. The contract, not a paper agreement, decides who is paid when the customer pays.
- **Agents with limits.** AI agents get an ENS name under the business, spending limits and an expiry; anything above a limit needs a fresh human approval through World.

## Why onchain stablecoin settlement on Whitechain

A card or bank rail cannot give a payer with no account and no gas a one-tap payment that still leaves a public, checkable receipt that is final in about a second. It cannot enforce a refund-approval limit, a subscription cap or an investor allowlist in code that neither side can bend, and it cannot let an unsold invoice become a restricted claim that pays its holder automatically when the customer pays. It also cannot give a software agent spending power that the payment itself refuses to exceed, or let an agent pay per request with no card on file. Here each of those is a contract rule or a signed single-use authorisation on Whitechain (USDT with EIP-3009 and permit, ERC-1271 for passkey accounts, a P-256 precompile for passkey signatures), not a policy someone promises to follow.

## Real payments in the official USDT

All use the official USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals) on Whitechain Sepolia, never a token we minted. Every link below was checked on the explorer (status success, called contract as listed).

**Current router (`0x4c32…dC0`), financing lifecycle of one 1.00 USDT invoice, 2026-11-06.** Merchant and customer paid no gas; the relayer sent each transaction.

| Step | What happened | Transaction |
|---|---|---|
| 1 | Merchant lets the relayer create invoices for it (`setCreator`) | [0xd571…89bd](https://explorer.testnet.whitechain.io/tx/0xd571bac8ce3a9121979fc1bcf06e6dfadbd3eb7313fa9b7cfcb8bbad600289bd) |
| 2 | Invoice created (`createInvoiceAsCreator`) | [0x669e…96e2](https://explorer.testnet.whitechain.io/tx/0x669e0c9a8f8df866c11cbcaefe3cdd47f9aae2bbe4b194e1626b31de96e2aff3) |
| 3 | Merchant lists the invoice for sale (`InvoiceClaim.list`) | [0xe501…291c](https://explorer.testnet.whitechain.io/tx/0xe5013ac1d8147fb57fbfd39617198f96aff8a0df69e099aab049dde2de70291c) |
| 4 | Investor funds the claim (`InvoiceClaim.fund`) | [0x575c…243f](https://explorer.testnet.whitechain.io/tx/0x575caa534d724cb81a7daaab76242f4a795000c7d515d5d324acba220748243f) |
| 5 | Buyer pays the invoice in USDT and the claim settles (`PaymentRouter.pay`) | [0x0473…7f3c](https://explorer.testnet.whitechain.io/tx/0x04735435d47b70ff1f2df8b2ca5896a9285f9eba572c108ad32cb2b8739a7f3c) |

Result: the investor paid 0.95 USDT and received 1.00 USDT; the merchant received 0.85 USDT when the claim was funded and 0.10 USDT (the reserve) at settlement; the router and the claim contract hold 0.00 USDT; the claim status is Settled; the buyer's on-time payment record went from 2 to 3. The run was made by `pnpm --filter @stenmont/scripts tokenization-lifecycle` ([`scripts/tokenization-lifecycle.ts`](scripts/tokenization-lifecycle.ts)). **Honesty note:** the investor was already allowlisted, and this script's allowlisting step is a labelled test shortcut that uses the attester key and bypasses the World proof. The walkthrough is in [docs/FINANCING_WALKTHROUGH.md](docs/FINANCING_WALKTHROUGH.md).

**Other payments in the official USDT**

| Payment | Router | Transaction |
|---|---|---|
| 1.00 USDT for an order in a store built from the Connect prompt (the payer held 0 WBT; sent through the relay) | current | [0xa25e…c3d71](https://explorer.testnet.whitechain.io/tx/0xa25e6e73e3dcaf747ef99a37fa818572fd78f5252e513b3b28aff514242c3d71), evidence in [docs/INSTALL-ACCEPTANCE.md](docs/INSTALL-ACCEPTANCE.md) |
| 0.01 USDT, an AI agent pays an x402 endpoint; the facilitator we run paid the gas | none (direct `transferWithAuthorization`) | [0x2a13…1e91](https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91) |
| 2.50 USDT gasless payment of an invoice the API created | **retired** `0xA5B6…929` | [0xa574…7a0d](https://explorer.testnet.whitechain.io/tx/0xa574d203ded29f21fadec46cceabe269551e43c82caadf08d29d9487cc817a0d) |
| 1.00 USDT first payment, payer 30.00 to 29.00 USDT | **retired** `0xA5B6…929` | [0x1439…518d](https://explorer.testnet.whitechain.io/tx/0x14398a2fa0244cf368184841c1872f9b012bb4c19f6b4b3c71152abd4ce3518d) |

The two retired-router payments predate the review fixes; that router was replaced and is kept in `contracts/deployments/1874.json` under `staging_retired`.

## Deployed contracts (Whitechain Sepolia, chain 1874, staging)

All are verified on the Whitechain explorer. `contracts/deployments/1874.json` is the single source of truth; `packages/shared` is generated from it and CI fails if they drift.

| Contract | Address | Deploy transaction |
|---|---|---|
| PaymentRouter | [0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0](https://explorer.testnet.whitechain.io/address/0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0) | [tx](https://explorer.testnet.whitechain.io/tx/0x4bcb2d2a9912443f925a1414dc035314e889d3709ff53db471d23fb973f335f3) |
| SubscriptionManager | [0x0e22748d63717D51eE8DFa5A62413A11dda981cF](https://explorer.testnet.whitechain.io/address/0x0e22748d63717D51eE8DFa5A62413A11dda981cF) | [tx](https://explorer.testnet.whitechain.io/tx/0xaab5c7478170190b37acce996003806c3e28057e688faa10aece75f6add56c8e) |
| PasskeyAccountFactory | [0x5101c37647581c81b462436af2D7ac8ccD08D33A](https://explorer.testnet.whitechain.io/address/0x5101c37647581c81b462436af2D7ac8ccD08D33A) | [tx](https://explorer.testnet.whitechain.io/tx/0xaf386d5465cef666a0642fd9a0378d6451b85adca29844afe5cb47500a1cd451) |
| InvestorRegistry | [0x6B8490a893C860888f65ce410b0b287CA1c9B8fa](https://explorer.testnet.whitechain.io/address/0x6B8490a893C860888f65ce410b0b287CA1c9B8fa) | [tx](https://explorer.testnet.whitechain.io/tx/0x19d9454b0736dac30dfc0bd42eab338a4fe89896d933f2ea04eba8a592ca6b93) |
| InvoiceClaim | [0x2EB9aaF14A2d729BC3F185A144571fCd23454914](https://explorer.testnet.whitechain.io/address/0x2EB9aaF14A2d729BC3F185A144571fCd23454914) | [tx](https://explorer.testnet.whitechain.io/tx/0xadf18d43838f11fa8f0772355d40ad54ca496930cc8f48e384a56ffad642a4ef) |
| ReputationRegistry | [0x751165C1E587637aF6EC0ff91b87Fa7Bd08a9ed5](https://explorer.testnet.whitechain.io/address/0x751165C1E587637aF6EC0ff91b87Fa7Bd08a9ed5) | [tx](https://explorer.testnet.whitechain.io/tx/0x9a9171a61fd55b6179a1ab1b35f079b0303c82775a05bf18ca204c8e7a21b1f8) |

What the contracts enforce: the router never keeps customer money (its USDT balance is zero after every call); a signed payment is bound to one invoice and cannot be redirected to another; refunds go only to real payers up to what they paid, and a large refund needs a platform-signed approval; a merchant cannot cancel an invoice after selling it; the claim token can only move between allowlisted holders and is frozen once settled; subscriptions have a hard cap on charges and no catch-up billing. Test suite in `contracts/test`: unit, fuzz (1,000 runs), handler-driven invariants and fork tests against the real USDT. Slither was run on the router and the passkey account with no high or medium findings, and an internal review is summarised in [SECURITY.md](SECURITY.md); the later financing contracts have not had a separate slither pass recorded. There has been no external audit.

## Architecture

```
 customer (passkey, no wallet)           merchant (passkey, dashboard / SDK / MCP agent)
          |                                          |
          v                                          v
   pay page  ---------->  API Worker (Hono)  <----  invoices, refunds, export, connect, financing
   (apps/web)               |      |      |
                            |      |      +-- webhooks (Cloudflare Queue, signed, retried)
                            |      +--------- indexer + renewals + reminders (Cron)
                            +---------------- relayer (Durable Object, one tx at a time, caps)
                                              |
                                              v
        Whitechain Sepolia (1874): PaymentRouter, SubscriptionManager, PasskeyAccount(+Factory),
        InvoiceClaim, InvestorRegistry, ReputationRegistry   --- official USDT (EIP-3009 / permit)

 AI agent --x402--> services/facilitator (verify + settle on Whitechain)     D1 (SQLite) for state
 AI agent --OAuth--> services/mcp (read invoices, draft refunds; a person signs)
 ENS (Sepolia): stenmont.eth -> business names -> agent names     World: IDKit + Agent Pass
```

Cloudflare Workers, D1, Durable Objects, Queues and Cron run the backend; Next.js 16 on Cloudflare (OpenNext) runs the web app. Details, the step-by-step payment and the trust model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Decisions: [docs/adr](docs/adr).

Third-party software we build on: OpenZeppelin Contracts 5.6.1 (including its WebAuthn and P-256 signer), forge-std, Foundry, Hono, Drizzle ORM, viem, zod, Next.js, OpenNext for Cloudflare, `@worldcoin/idkit`, Playwright and Vitest. Everything else in this repository was written during the hackathon.

## Setup

Needs Node 26.13.0 (`.nvmrc`), pnpm 12 and Foundry 1.9.0. Every command below exists in the repository's `package.json` or `foundry.toml`.

```bash
pnpm install                                   # a harmless "ignored build scripts" notice may appear
cp .env.example .env                           # names only; paste your own test keys (never commit .env)

# TypeScript tests (API, shared, SDK, React, x402, agent, facilitator, MCP, web, scripts)
pnpm -r test
pnpm -r lint                                   # tsc --noEmit in each package

# Contracts
cd contracts
forge soldeer install                          # dependencies are not committed
forge build && forge test                      # unit, fuzz, invariant
forge test --profile fork                      # fork tests against the real USDT (public Whitechain RPC)
cd ..

# Run locally
pnpm --filter @stenmont/api db:migrate:local   # local D1
pnpm --filter @stenmont/api dev                # API on :8787
pnpm --filter @stenmont/web dev                # web app on :3000
```

Secrets live in Cloudflare (`wrangler secret`), per environment. `.env` is a local paste area and is gitignored. The order of work is local, then staging, then production; production scripts refuse to run without `STENMONT_CONFIRM_PRODUCTION=yes`, and nothing is deployed to production. Browser tests: `pnpm --filter @stenmont/web e2e` (Playwright with a virtual passkey, against staging by default).

## How gas works (Scale track)

The payer never holds WBT, signs a gas-costing transaction or sees a chain. The payer signs one USDT authorisation with a passkey; a relayer we run sends the transaction.

- **Who pays:** the merchant. Each merchant has a gas tank: an amount of WBT set aside for its customers' payments. The relayer sends the transaction and, after the receipt, the real cost (`gasUsed x effectiveGasPrice`) is taken from that merchant's tank. Subscription charges, cancellations and investor funding use the same tank (the seller's, for financing).
- **Where the relayer's WBT comes from:** the relayer is an ordinary wallet funded with WBT (from the test network faucet today). The tank is the accounting of who may spend how much of it. The relayer refuses to send if it would end below a floor of 0.02 WBT, so it never runs dry mid-payment. Today a merchant's tank is set by an operator script (`scripts/fund-gas-tank.ts`) and shown read-only in Settings; a self-serve top-up where the merchant sends WBT is not built (see limitations).
- **What stops draining:**
  - A payment authorisation is bound to one invoice and one amount (its nonce is derived from the invoice id), and the token accepts it once. A replay or a redirect to another invoice fails.
  - Every call is simulated first, so a bad request costs nothing.
  - 100 requests a minute per payer and per IP, a daily USDT cap per payer, and a daily gas cap per merchant.
  - Gas is reserved from the tank before sending with one atomic compare-and-swap, so concurrent requests cannot overspend; a request that cannot get its reservation is told `busy` (retry), which is reported separately from "limit reached".
  - One transaction at a time through a Durable Object, with consecutive nonces.
  - A race we found ourselves is fixed and tested: under about 50 simultaneous payments, settlements could be silently dropped and a merchant over-charged (never under-charged, never double-settled). It is reproduced deterministically in `services/api/test/relayerRace.test.ts` and explained in [docs/RELAYER.md](docs/RELAYER.md).
  - Attack tests in `services/api/test/drain.test.ts` (200 replays from one payer send exactly one transaction; concurrent replays send one; 50 honest payers all get through under the cap; a rotating-address flood is stopped at 100 requests a minute; a flood of invalid authorisations spends no gas and sends nothing) and `relayer.test.ts`, plus a live drain run on staging (`scripts/drain-sim.ts`).

Not yet covered, and listed in [SECURITY.md](SECURITY.md): invoice creation, account activation and refunds are rate limited but do not draw from the gas tank, and a receipt timeout leaves a reservation held with no automatic reconciliation.

**What the payer sees:** one button, a passkey prompt, "Paying acme.stenmont.eth", the amount and due date, then the merchant's return page. A test (`apps/web/test/pay.test.ts`) fails if any user-facing pay-page error message contains a crypto word (gas, wallet, token, chain and so on). In the test environment a brand-new payer account is topped up with 5 test USDT from a faucet wallet (limited per IP per day) so a judge can pay without having any; those are official test USDT held by our demo wallet, and in production this does not exist. Payers who already hold USDT can pay from their own wallet instead (the option appears when a browser wallet is present; it signs the same single-use authorisation and the same relay pays the gas).

## Payers bring their own USDT

Stenmont does not sell USDT, take cards or run an on-ramp, and we make no claim that it does. A payer needs USDT on Whitechain, and the pay page's help screen (`apps/web/lib/funding.ts`) says only what Whitechain's own tools do:

1. From the **WhiteBIT** exchange: hold or buy USDT there, withdraw it and choose the Whitechain network.
2. From another network: Whitechain's **Portal bridge** ([mainnet](https://bridge.whitechain.io), [testnet](https://bridge.testnet.whitechain.io)) moves USDT from the networks it supports, such as Ethereum and Tron.

A business receiving USDT moves it to a local bank through a licensed off-ramp partner of its choice; that is information, not a feature we run. Whether the official USDT will be available on Whitechain mainnet, and when, is not confirmed by us (Whitechain's docs say it follows later releases after audit): check before relying on it.

## Why Proof of Human is the minimum credential (IDKit)

The trust moments are three, and each needs the same thing: to know that a distinct, living person is behind the action, and nothing more.

1. **One person, one business.** When a business verifies, the proof goes to World's verifier from our server; the returned nullifier is stored under a unique index, so the same human cannot register a second business ("already verified a business").
2. **Buyer and supplier must be different people.** An invoice that names a buying business is refused when both sides trace to the same verified human, so a business cannot invoice itself to farm payment history or sell a fake receivable.
3. **Investors on the allowlist.** Before the attester signs an investor into `InvestorRegistry`, the investor must present a Proof of Human, so a sold invoice cannot be bought by a swarm of fake accounts.

Why not a passport or a selfie check: every question here is "is this a different human than the last one", not "who is this" or "where are they from". A passport credential would collect document facts we have no use for, and would lock out people without a supported document. A selfie check yields a Sybil score, which is a risk estimate; the nullifier from Proof of Human is an exact value we can put behind a unique database index, which is the rule we need. Where a business really needs more (the highest financing limits, investing with real money), the platform asks for a document check from a KYC provider instead of pretending a human check is enough; that tier is only a sandbox stand-in today (see [docs/VERIFICATION.md](docs/VERIFICATION.md)).

The alternative paths are built and tested: a cancelled widget, a rejected proof, and a second business by the same person (refused and left unverified). All proofs on World's test network use fake identities and must not be relied on in production.

## Privacy: onchain payments are public

A USDT transfer exposes the sender address, the receiver address, the amount and the time to anyone. Invoice details and customer emails stay in our database; onchain there is only an invoice id. If an address is publicly tied to a company (for example an ENS name that resolves to it), that company's incoming payments are visible. Mitigations we have not built: a fresh receiving address per invoice and hiding the ENS name on private pay pages. Do not use this where payment amounts or counterparties must stay secret.

## Tracks to evidence

Status words: **proven live** = run on staging against the real chain and services, with a link or a recorded run; **built** = implemented and tested locally, not shown live; **missing** = not done. The line-by-line audit with next actions is [docs/TRACK-CHECKLIST.md](docs/TRACK-CHECKLIST.md).

| Requirement | Evidence | Status |
|---|---|---|
| **All Whitechain tracks**: contracts on Whitechain Sepolia, verified on the explorer | [Deployed contracts](#deployed-contracts-whitechain-sepolia-chain-1874-staging), `contracts/deployments/1874.json` | proven live |
| At least one settled payment in the official USDT, explorer link in README | [Real payments](#real-payments-in-the-official-usdt) | proven live |
| Why onchain stablecoin settlement | [Why onchain](#why-onchain-stablecoin-settlement-on-whitechain) | done |
| Public repo with steady progress; setup, architecture, limitations | This README; about 270 commits dated 5 and 6 November 2026 on this line | done once pushed (owner pushes) |
| Demo video of 2 to 4 minutes at real speed, each party | Shot list in [DEMO.md](DEMO.md) | missing: not recorded yet |
| `WHITECHAIN_FEEDBACK.md` | [WHITECHAIN_FEEDBACK.md](WHITECHAIN_FEEDBACK.md) | done |
| **Operate**: drop-in piece a separate app adds in about 20 lines | SDK + [example store, 10 lines](apps/example-store/INTEGRATION.md); isolated store built from the Connect prompt took a real payment | proven live |
| Operate: merchant and customer views | Dashboard (`/dashboard`), pay page (`/pay/<id>`), customer account page (`/account`) | proven live (dashboard and pay page); account page built |
| Operate: refund, renewal, accountant export | Refund with passkey, subscription with two renewals and a customer cancel, CSV (generic and QuickBooks) on real data | proven live |
| Operate: due dates and reminders | `invoice.reminder` webhooks (3 days before, due, 3 days after), hourly job | built (no live reminder shown) |
| **Tokenize**: rules in the contract, a full lifecycle step | `InvoiceClaim`, `InvestorRegistry`, `ReputationRegistry`; lifecycle links above | proven live (contracts, with the allowlist shortcut); default path covered by unit and fork tests only |
| **Scale**: zero-crypto payer, how gas is paid, what stops draining | [How gas works](#how-gas-works-scale-track), [docs/RELAYER.md](docs/RELAYER.md), drain tests | proven live (gasless pay); drain tests and a live drain run |
| Scale: x402 pay-per-request through a facilitator we run | `services/facilitator`, [agent payment](https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91) | proven live |
| **World Agent Pass**: official integration, request, completion, validated result, protected action | OIDC sign-in with PKCE, token checked in the backend, gates large refunds and large agent limits | built; the sign-in has not been completed by a real person, so the full journey is not shown live |
| Agent Pass: a denied or expired path where the action does not happen | Route tests (`services/api/test/worldRoutes.test.ts`) | built; not shown live |
| Agent Pass: debrief | [WORLD_FEEDBACK.md](WORLD_FEEDBACK.md) | done |
| **IDKit**: functioning integration, server-side verification, success and an alternative path | Proof of Human via World's simulator; duplicate-person refusal | proven live (simulator) |
| IDKit: why the credential is the minimum | [Why Proof of Human](#why-proof-of-human-is-the-minimum-credential-idkit) | done |
| **ENSv2**: central to the product, functional, live demo, open source | Names, per-name resolvers, record-scoped roles, payout lock, agent names on Sepolia; docs in [docs/ENS_DIRECTORY.md](docs/ENS_DIRECTORY.md) and [plan/05-identity.md](plan/05-identity.md) | proven live (names, roles, payout lock, agents); pay directory and tier record not run on Sepolia |

## Current limitations

- **Testnet only.** Chain 1874 with valueless test tokens. Production is not deployed. Test USDT in staging comes from a faucet wallet we fund, which limits repeated runs.
- **No external audit.** Internal review, slither and extensive tests only. Owner and guardian of every contract are one deployer wallet today; a multisig is planned before any real value. The shared relayer can create invoices for any merchant that enabled delegation, and the API (not the contract) pins the payout.
- **Lost passkey.** Email or Google sign-in can restore read-only dashboard access, but a lost passkey cannot replace the signer of the business's onchain payout account. Recovery is a design note only ([plan/13-payout-recovery.md](plan/13-payout-recovery.md)); until it is built, funds in an account whose passkey is lost cannot be moved.
- **World.** On the test network World mocks proofs. IDKit was proven through World's public simulator, which is one fixed identity, so "buyer and supplier are different people" is proven by tests, not by two real people. A real Agent Pass sign-in by a person has not been completed.
- **Verification is partly a stand-in.** The document-check tier uses a sandbox KYC provider that never looks at a person or document; no real KYC or sanctions-screening provider is integrated. Investors are allowed with a World proof only in the test environment; production would require the document tier.
- **Financing.** The live lifecycle used the labelled allowlist shortcut. The default path (7 days after the due date) was not run live. Legal review is needed before any real investor.
- **USDT on mainnet.** We have not confirmed that the official USDT is available on Whitechain mainnet; check before any launch.
- **Gas tank.** Set by an operator today, no self-serve top-up; invoice creation, activation and refunds do not draw on it; a receipt timeout is not reconciled automatically; abandoned invoice creation has no durable recovery.
- **Books.** Export dates are when our indexer recorded the event (within about a minute), not the block time. Reconciliation, tax lines and period close are not built.
- **Privacy.** Onchain payments are public (see above).
- **Not run live:** paying from an existing wallet through the hosted page in a browser, real email delivery, Google sign-in, the ENS pay directory and tier record on Sepolia, and a refund above the approval threshold completed by a real World sign-in.
- **Fonts.** Adobe Fonts project licences are used until web licences are bought.

## Before and during the hackathon

Stenmont was started from an empty repository for this event: the first commit is dated 5 November 2026 and everything in the history was written during the hackathon (see `git log --reverse`). It is not entered for the Continuity track, which is for products that already existed.

## Tests

`pnpm -r test` on this branch: 1,341 Vitest tests pass (API 905, web 215, shared 46, install-proof 37, agent 26, facilitator 31, scripts 22, MCP 17, x402 15, SDK 14, example store 10, React 3), plus 15 `node:test` cases in `scripts`. Contracts: `forge test` (unit, fuzz, invariant) and `forge test --profile fork`.

## More

Security: [SECURITY.md](SECURITY.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Decisions: [docs/adr](docs/adr). Feedback for the sponsors: [WHITECHAIN_FEEDBACK.md](WHITECHAIN_FEEDBACK.md), [WORLD_FEEDBACK.md](WORLD_FEEDBACK.md), [ENS_FEEDBACK.md](ENS_FEEDBACK.md). Builders Program draft: [docs/BUILDERS_PROGRAM.md](docs/BUILDERS_PROGRAM.md).

## Licence

Apache-2.0, see [LICENSE](LICENSE).
