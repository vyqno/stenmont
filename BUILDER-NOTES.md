Fetched the partner tracks (Whitechain, World, ENS); what they want us to build is in [PS.md](./PS.md).

## My progress so far

- Created a new Gmail account
- Created a new Cloudflare account
- Bought a .com through that Gmail account
- Registered the domain
- Bought the ENS name
- Set up R2 and the other Cloudflare services
- Set up Wrangler

## Secrets

- Raw keys are never put in code, config, git, or `wrangler.jsonc`. Real secrets live in Cloudflare (`wrangler secret`), per environment (staging and production).
- `.env` is only my local paste area for tokens. It is gitignored and never committed.
- `.env.example` is only a reference: it lists the names of the keys and how each is stored in Cloudflare. No values.
- Public settings (RPC URLs, chain id, token address) are plain `vars` in `wrangler.jsonc`, not secrets.
- Order of work: local, then staging, then production. Production only when I say.

## Progress

- 23:55 Plan written in `plan/`: one file per phase, 0 (prerequisites) to 8 (ship). Database is Cloudflare D1, not Postgres.
- 23:55 Cloudflare connected (Stenmont account), `stenmont.com` registered, skills installed.
- 00:07 Prerequisites: Node 26.13.0, pnpm 12.16.1, Foundry 1.9.0, ENS CLI installed; Email Sending enabled on stenmont.com; four test wallets created in .env. Plan: D1 (not Postgres).

---

Committed 00:15 on `cloudflare-stack` (up to `ef2de18`): readme, plan, MCP config, skills, agent context, notes.

---

- 00:17 `.env` placeholders added for World (Agent Pass and IDKit), Cloudflare token and webhook test URL. Waiting on test funds and World apps.
- 00:34 Test funds received and checked: deployer 0.3 WBT + 10 USDT + 2 Sepolia ETH, relayer 0.4 WBT, demo payer 30 USDT.
- 00:34 `stenmont.eth` is registered on Ethereum mainnet (owner `0x104C…3f3E`, expires 2027-11-05); not registered on Sepolia yet.
- 00:34 Phase 1 started.
- 00:56 Task 1.1 done: pnpm 12 workspace, `.nvmrc` (26.13.0), `.editorconfig`, `.env.example`.
- 00:56 Task 1.2 done: `packages/shared` (money, invoice ids, chain config, USDT EIP-712). USDT domain separator matches the on-chain value. 9 tests pass.
- 00:56 Found: the USDT implementation supports both EIP-3009 signature forms (`bytes` and `v,r,s`) and permit. Smart-account payers use the `bytes` form.
- 00:56 Task 1.3 done: Foundry project in `contracts/` (solc 0.8.38, deps via soldeer), 1 test passes.
- 00:56 Task 1.4 done: API Worker (Hono) with D1 schema and append-only audit log. 5 tests pass. Tests use `app.request` and `node:sqlite` instead of the Workers test pool.
- 00:56 Environments split into local, staging and production for the API and web Workers. Staging is live: `api-staging.stenmont.com` and `app-staging.stenmont.com`, each with its own database for the API. Production web is not deployed. The production API (health only, empty database) was deployed earlier, before this rule.
- 00:56 Secrets pushed to Cloudflare for the staging and production API Workers (7 each: relayer and attester keys, World client id and secret, World app and RP ids, session secret). `WORLD_RP_SIGNING_KEY` not pushed: the value in `.env` is an address, the private key is needed.
- 00:56 Task 1.5 mostly done: Next.js 16 landing page on Cloudflare, live on staging. `cacheComponents` and `partialPrefetching` removed from `next.config.ts` because they made the Worker hang (error 1101).
- 00:56 RPC check: Whitechain public RPC and Tenderly Sepolia both work (Tenderly has full archive history); publicnode Sepolia is pruned. Keep both as they are.
- 00:56 `stenmont.eth` is available on Sepolia for 8.000021 MockUSDC a year. Not registered yet.
- 01:08 `stenmont.eth` registered on Sepolia (owner: deployer wallet, new resolver deployed, valid to 2027-11-05). `WORLD_RP_SIGNING_KEY` (private key) pushed to the staging and production API Workers; each now has 8 secrets.
- 01:08 Smart contract direction: a full, advanced suite with every rule enforced onchain (see `plan/contracts.md`), tested with unit, fuzz, invariant (handler-driven) and fork tests against the real USDT.
- 01:08 Using Austin Griffith's `ethskills` (installed in `.claude/skills/ethskills`) as the contract and testing standard.
- 01:08 After the whole contract suite is done: run Pashov's `solidity-auditor` and `x-ray` skills (already installed), then Trail of Bits skills (`npx skills add trailofbits/skills`), and fix every finding.
- 01:19 Contract C1 `PaymentRouter` built and tested: invoices, partial pay with a minimum, payer lock, due dates, refunds only to real payers up to what they paid, delegated creation, payout hook for sold invoices, pause, and human approval for large refunds. A signed payment cannot be redirected to another invoice (nonce derived from the invoice id).
- 01:19 Tests for C1: 67 unit, 11 fuzz (1,000 runs each), 3 handler-driven invariants (25,600 calls, 0 reverts), 8 fork tests against the real Whitechain USDT at block 12,308,524 (including a smart-account payer and a rejected redirect attack). 100% line, statement, branch and function coverage.
- 01:19 slither: no high or medium findings; 7 intentional timestamp notes (deadlines). It cannot parse OpenZeppelin's transient guard, so I also ran it on a copy with the storage-based guard. Installed in `~/.venvs/slither`.
- 01:19 `packages/shared` ids now match the contract exactly (merchant-scoped ids, payment and refund nonces). The same independently computed vectors are asserted in both TypeScript and Solidity.
- 01:19 Not deployed yet: Task 2.3 (deploy to Whitechain Sepolia, staging first). Remaining contracts: C2 to C11 in `plan/contracts.md`.
- 01:20 Added Task 1.7 (repository standards: license, commit rules, hooks, CI, architecture docs, ADRs, security docs, release tags) to `plan/01-foundation.md`.
- 01:27 New branch `phase-1-ci-cd`. Task 1.6 done: GitHub Actions CI (TypeScript, contracts, web build, weekly fork tests) with actions pinned to commit SHAs. Every CI command passes locally. Contracts formatted with `forge fmt` (no behavior change; all 79 unit and 8 fork tests still pass). ESLint now ignores generated `.open-next` output.
- 01:27 Task 1.8 planned: CD on Cloudflare Workers Builds. Merge to `main` deploys staging; fast-forward of `release` deploys production behind `STENMONT_CONFIRM_PRODUCTION=yes`. No Cloudflare token in GitHub. Needs the GitHub org repo and Cloudflare's GitHub app first.

---

## Phase 2 links (staging, Whitechain Testnet 1874)

- PaymentRouter (verified): https://explorer.testnet.whitechain.io/address/0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929
- Deploy transaction: https://explorer.testnet.whitechain.io/tx/0xf4c5a9d7146b0a487b8e3fd5f589a47e9923787c5fef01a0fe12d7e2e3f927db
- First invoice created: https://explorer.testnet.whitechain.io/tx/0x08c86c8d0fc45e4d7d27ddcfc44e58c28d97a7899e514cfdd500049c4482421f
- First payment in the official USDT: https://explorer.testnet.whitechain.io/tx/0x14398a2fa0244cf368184841c1872f9b012bb4c19f6b4b3c71152abd4ce3518d

---

- 01:34 New branch `phase-2-payments`. Task 2.3 done: `PaymentRouter` deployed to Whitechain Sepolia as the staging deployment and verified. Owner and guardian are the deployer wallet for now (move to a multisig before real value); attester is the attester wallet; refund approval threshold 100 USDT.
- 01:34 First real payment: 1.00 official USDT. Payer went 30.00 to 29.00 USDT while holding 0 WBT (the relayer paid the gas), merchant 10.00 to 11.00, invoice Paid. Links above.
- 01:34 `contracts/deployments/1874.json` is now the one source of truth for addresses. `packages/shared` is generated from it and from the contract ABI; CI fails if they drift.
- 01:34 Next: Task 2.4 (API keys, invoices, payment links), then 2.5 (indexer, webhooks).

---

@me: while my agent is working i am focusing on the branding of the product i am building.

---

## Phase 2 end-to-end on staging (the full pipeline)

- Delegation (merchant allows the relayer to create invoices): https://explorer.testnet.whitechain.io/tx/0x29280d4844f5a9dd3172029897be163e3eef3be71b8fc25fa6d7bd1043480bab
- Invoice created through the API (`POST /v1/invoices` on `api-staging.stenmont.com`, created onchain by the relayer): https://explorer.testnet.whitechain.io/tx/0xa7b5f561d41c99a4d2b05adebce5e1b3cb461cf11c1a7f3847273c13a0e79d6f
- That invoice paid with 2.50 official USDT: https://explorer.testnet.whitechain.io/tx/0xa574d203ded29f21fadec46cceabe269551e43c82caadf08d29d9487cc817a0d
- The indexer marked it paid and delivered two signed webhooks (`invoice.created`, `invoice.paid`), both HTTP 200 on the first attempt.

---

- 01:58 Task 2.4 done: API keys, invoices (idempotent, validated, tenant-scoped), payment links, public pay data, webhook endpoints. The API creates invoices onchain through the router's delegation, so it never holds a merchant key.
- 01:58 Task 2.5 done: chain indexer on a minute cron and signed webhooks on a queue with retries. 68 API tests, plus the full path run on staging against the real chain.
- 01:58 Found while testing: invalid amounts like `-1` returned a 500 instead of a 400 (zod runs refinements after the regex fails). Fixed with a test.
- 01:58 Found on staging: a new cron trigger takes several minutes to start after its first deploy. The cursor then advances normally.
- 01:58 Open: production deploy needs a production router, then migrations, the production queue and cron. Phase 3 next: Durable Object relayer with caps, passkey account, zero-crypto pay page.
- 02:13 New branch `phase-3-gasless`. Spike 0.2: the P-256 precompile at `0x100` IS live on Whitechain Sepolia (my first test vector was wrong because Node hashed the input twice; a Foundry-generated vector passes on the live chain and is rejected when tampered).
- 02:13 Task 3.1 done: `PasskeyAccount` and `PasskeyAccountFactory`, built on OpenZeppelin's WebAuthn signer. 21 new tests, a fork test through the real USDT, slither clean. Staging factory `0x5101c37647581c81b462436af2D7ac8ccD08D33A` (verified).
- 02:13 Browser note: the passkey signature must be the six WebAuthn fields ABI-encoded flat, not as a struct. Recorded in `plan/03-gasless.md` for Task 3.3.
- 02:13 Next: Task 3.2 (Durable Object relayer with caps and the account deploy-on-first-use), then 3.3 (pay page) and 3.4 (drain tests).

---

## How the gas works (for the README: Scale track)

- **Who pays:** the merchant. Each merchant has a gas tank, an amount of WBT set aside for their customers' payments. The relayer sends the transaction and the real gas cost is taken from that tank after the receipt.
- **Where the relayer's WBT comes from:** the relayer wallet is funded with WBT (the faucet for the test network); the tank is the accounting of who may use how much. The relayer refuses to work below a floor of 0.02 WBT, so it never runs dry mid-payment.
- **What stops draining:** a customer's approval is bound to one invoice and one amount, and the token accepts it once; one transaction per approval; every payment is simulated first so bad requests cost nothing; 100 requests a minute per payer and per IP; a daily USDT cap per payer; a daily gas cap per merchant; budgets are reserved atomically so concurrent requests cannot overspend; busy is reported separately from a reached limit. Proven by attack tests and a live run on staging.

---

- 02:40 Task 3.2 done: Durable Object relayer (one transaction at a time, consecutive nonces), the public relay with limits and gas reservation, first-use account deployment in one Multicall3 transaction, gas tanks, faucet for test environments, CORS for our app only. 119 API tests.
- 02:40 Task 3.3 done: the pay page. One button, a passkey for the account, test funds added automatically in test environments, no crypto words (enforced by a test). Playwright with a virtual authenticator passes on staging.
- 02:40 Task 3.4 done: attack tests and a live drain run on staging. 15 concurrent replays sent one payment; 120 bad authorizations cost nothing.
- 02:40 Found by the tests: simultaneous honest payments could be refused as "limit reached" while others held reservations. Now reported as busy and retried quietly by the pay page.
- 02:40 Found by the tests: a Foundry-signed assertion and a browser-style assertion must use the same flat encoding; a real vector now pins TypeScript and Solidity together.
- 02:40 Phase 3 complete on staging. Production still pending (needs its own router, factory, migrations, queue, cron and gas tank).

---

Committed 02:41 on `phase-3-gasless` (up to `dc9f109`): Phase 3 (passkey account, relayer with caps, pay page, drain tests).

---

- 02:48 New branch `phase-4-plug-in`. Task 4.1 (delegated invoice creation) was already built into the router in Phase 2.
- 02:48 Task 4.3 done: `SubscriptionManager` (signed once, hard cap on charges, no catch-up billing, cancel any time, works with passkey accounts). 43 tests, a fuzz test caught a double-charge bug at exactly one period late (fixed), the invariant run caught that a permit overwrites rather than adds to the allowance (fixed by letting the signer choose the permit value). Staging: https://explorer.testnet.whitechain.io/address/0x3e1C51d461e6adb0b087DC39d41942E084eba2DD (verified).
- 02:48 Phase 4 remaining: 4.2 magic-link login and onboarding, 4.4 refunds, subscriptions, reminders and CSV export in the API, 4.5 SDK and React button, 4.6 the example store, 4.7 the merchant dashboard.
- 02:57 Research for the real-world direction, written up in `plan/differentiation.md`: what Whitechain asked for in its ETHGlobal Mumbai talk (build what real business needs, justify why onchain beats Stripe, hide the blockchain for the Scale track, Builders Program up to $300k), the competitor map (Request, Bitwave, Centrifuge, Credix, Huma: most do one third of the loop), and our angle (one closed loop: get paid, books close themselves, get paid early, agents with limits enforced onchain).
- 02:57 Phase 9 (make it real) planned in `plan/09-real-world.md`; it is built after Phases 4 to 7 are complete and reviewed.
- 02:57 Brand: `brand-guidelines/` now has COLORS (Whitechain's own tokens), LOGO (lowercase "stenmont", All Round Gothic, tracking 10), TYPOGRAPHY and PROMPT (every asset prompt). The Neue Haas Grotesk and All Round Gothic files are trial and demo versions, so they are kept out of git; buy the web licences before launch.
- 02:57 Could not read: Whitechain's recent posts on X (needs a logged-in session) and one of their talks' transcripts (the video site rate-limited the fetch).
