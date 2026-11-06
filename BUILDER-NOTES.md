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
- 03:10 Task 4.2 done, changed from the plan: passkey sign-up and sign-in instead of magic links (no password, no code). Two prompts at sign-up: create the passkey, then approve setting up the account. That second signature is the one the router checks onchain, so one transaction creates the account and lets the relayer create invoices for it. API key shown once; session cookie is HttpOnly, Secure, SameSite=Lax, and cookie writes must come from our own app. 22 new API tests (141 total), live on staging with Playwright (sign up, sign out, sign in) and the activation transaction confirmed onchain.
- 03:10 Found: a challenge must not be burned by a failed attempt (the user can retry) but must be held while a request works on it; done with a short lock that expires by itself if a request dies. Each activation costs gas, so it is limited per IP and per day for the whole platform.
- 03:10 Lost passkey = lost account for now. Recovery (second passkey) is planned in Phase 9.
- 03:35 Task 4.4 part 1 done: the indexer now keeps a refund ledger (one row per refund, safe to re-read), and `GET /v1/exports/payments.csv` gives an accountant every payment in and refund out, signed, as a generic CSV or QuickBooks upload layout. Spreadsheet formulas in invoice numbers are defused, commas and quotes are quoted, dates are validated. 147 API tests pass; migration 0005 and the API are on staging. Not checked live: no staging API key is stored locally; unit tests cover it.
- 03:35 Found: zod runs refinements even after the pattern check fails, so a refinement that can throw (`toISOString` on `2026-13-40`) returns a 500. Same trap as the amount bug; both now catch it.
- 03:35 Export dates are when the indexer recorded the event (within about a minute), not the block time. Acceptable for books; the chain client does not return block timestamps yet.
- 04:20 Task 4.4 part 2 done: refunds through the merchant's passkey. `POST /v1/refunds` works out who can be refunded and how much (what they paid minus earlier refunds, partial allowed) and returns the exact token authorisation to sign; `POST /v1/refunds/:id/submit` checks the passkey signature, then the router redeems it. A request can be sent once, expires after an hour, and a chain failure leaves it retryable. Above 100 USDT it stops with `approval_required` (the human-approval step lands with World in Phase 5). 158 API tests pass; migration 0006 and the API are on staging. Not run live yet: a real refund needs a paid invoice on a passkey-created business; the contract side is covered by the fork tests.
- 04:20 Note: refund gas is not yet taken from the merchant's gas tank. Refunds need a passkey signature and real payments, so abuse is bounded, but add the accounting when the dashboard shows the tank.
- 04:45 Task 4.4 part 3 done: due-date reminders. Every hour the cron sends a signed `invoice.reminder` webhook (stage `due_soon` 3 days before, `due`, `overdue` 3 days after) for unpaid invoices, one per invoice per stage, never repeated. 162 API tests pass; deployed to staging (the cron fires every minute, the reminder job only on the hour).
- 04:45 Decision: reminders are webhooks, not emails. No email-sending binding exists in the Worker yet, and the merchant's own system knows how to word a message to its customer. An email option can be added once the binding is set up.
- 05:30 Task 4.4 part 4 done: subscriptions API and renewals. A merchant creates an offer (`POST /v1/subscriptions`, amount, period, at most N charges) and gets a link; the customer signs once and the relayer sends it, with the merchant's gas tank paying; the customer can end it with their own signature. Every minute the cron charges what is due, re-reads the schedule from the contract, and emits `subscription.charged`. A failed charge (customer short of funds) retries a day later; after three failures the subscription is `past_due` and automatic tries stop (`subscription.past_due`). Our own problems (empty gas tank, RPC error) are never counted against the customer. 173 API tests pass; migration 0007 and the API are on staging. Not run live: a real subscription needs the customer page (permit signature), which is still to build.
- 05:30 Limit: a merchant "cancel" stops our charging only. The contract lets only the payer end it by signature (the merchant is a passkey account and cannot send a transaction), so the customer can always end it onchain. Shared helper `sendFromTank` now does simulate, reserve gas from the tank, send, settle for subscribe, cancel and charge.
- 06:15 Task 4.5 done: `@stenmont/sdk` (invoices, checkout sessions, refunds, subscriptions, CSV export, `verifyWebhook`) and `@stenmont/react` (`<PayButton/>`, a plain link that refuses non-web addresses). To make checkout real the API now accepts `successUrl` and `cancelUrl` on an invoice, and the pay page sends the customer back after paying. 178 API tests, 14 SDK, 3 React, 9 web. Live on staging: a fresh business made with the SDK, paid by a customer with a passkey, returned to the shop, and listed in the accountant export. That one run also proves the CSV export works on real data.
- 06:15 Found: the SDK and the server sign and check webhooks separately, so a test now makes the SDK verify what the server signs. Next: 4.6 example store, 4.7 dashboard.
- 07:05 Task 4.6 done: example store at `shop-staging.stenmont.com`, a separate Worker with orders in KV. Baseline committed first (plain cart, fake Pay button), then Stenmont added in 10 lines of source (see `apps/example-store/INTEGRATION.md`). Live run passes: buy, pay with a passkey on the Stenmont page, return to the shop, order turns paid by the signed webhook. Secrets (`STENMONT_API_KEY`, `STENMONT_WEBHOOK_SECRET`) are in Cloudflare only; temporary key files were deleted.
- 07:05 Found: the staging faucet wallet ran out of test USDT after repeated test runs (each new shopper gets 5). I moved 15 test USDT from the deployer wallet to the demo payer wallet (the faucet), so it holds 17.5. Demo products are priced under $5 for the same reason.
- 07:05 Decision: the 20-line target was a ceiling; the integration is 10 lines and was not padded.
- 08:05 Task 4.7 done: the merchant dashboard (Overview, Invoices, Subscriptions, Settings) with the Whitechain palette and logo style. Live on staging in one run: sign up, create an invoice, a customer pays the link, the dashboard shows Paid, the business refunds with its passkey, it shows Refunded, the CSV lists payment and refund, Overview shows $0.00. That was the first real refund end to end (the contract side was covered by fork tests; now the API, passkey signature and USDT all agree live).
- 08:05 Found: repeated test runs hit the abuse limits that exist on purpose (faucet 5 per IP per day, 5 sign-ups per IP per hour). I did not weaken them: both are now settings (`FAUCET_IP_LIMIT`, `ACTIVATE_IP_LIMIT`), defaults unchanged, raised on staging only. 183 API tests.
- 08:05 Found: the session now returns the passkey it was started with, so signing a refund asks for that passkey, not another one the device holds (a customer's, for example).
- 08:05 Fonts: Onest is used until Neue Haas Grotesk and All Round Gothic are licensed; the CSS names them first, so adding the files switches the site over.
- 08:05 Funds: the staging faucet (demo payer wallet) holds about 7.5 test USDT after these runs. More test USDT to `0x855Fd4b51Adf6386b7d533F59a47E3016973De11` keeps the live tests running.
- 08:55 Customer subscribe page done and verified live. A customer opens the business's link, confirms twice (agreement, then the permit), and the first payment is taken at once; the cron then charges each period until the limit. On staging a $1.00-every-minute subscription with 2 payments went subscribed, 1 of 2, 2 of 2, completed; a second customer cancelled with one confirmation and the business saw it as cancelled. This also settles the open question from earlier: the live renewal and the live cancel both work with a passkey account.
- 08:55 `/relay/account` now also returns the token permit nonce and the current allowance to the subscription contract, because a permit SETS the allowance: the customer signs "what is already approved + this agreement's cap". Shared package gained `buildPermit` and a test pins the standard Permit typehash.
- 08:55 Phase 4 is complete. Open items for later: refund gas is not yet taken from the gas tank; the production deploy (router, factory, subscription contract, migrations, cron, queue, tank) waits for your go-ahead.
- 10:20 Phase 5 started. Fonts: your Adobe Fonts project is wired in (Neue Haas Grotesk Text and Display, All Round Gothic); the project's domain list must include stenmont.com and localhost.
- 10:20 Tasks 5.1 and 5.2 done. The ENSv2 contracts on Sepolia are an older build than the repo's main branch, so I read the deployed behaviour (ENS's own CLI source plus the code at commit 07e55a05) and proved it live. Findings are in `plan/05-identity.md`. Key ones: subnames are created with `register()` on the parent's registry; permissions on a resolver belong to a record key, not a name, so each name needing its own permissions gets its own resolver; rights are granted with `grantSetterRoles`; a payout lock works by dropping the registrar's root rights after pre-granting the keys it keeps, and it is permanent.
- 10:20 `stenmont.eth` now has a subname registry and a dedicated registrar wallet. Live spike: 13 checks pass on Sepolia (finance member edits only the profile record, the payout lock holds even against the registrar, the name resolves through the standard ENS path).
- 10:20 ENS feedback for the submission: no `createSubname` function exists (the docs say register on the parent registry); the deployed contracts differ from main so source and chain disagree; reading a record needs `resolve(name,data)` not `text()`; the Tenderly Sepolia gateway refuses raw transactions. The ENS CLI source was the most reliable documentation.
- 11:05 Tasks 5.3 and 5.4 done and live on staging: a business claims `label.stenmont.eth` (own agent registry, own resolver, owned by its payout account), the name resolves through standard ENS to the business account, a finance member can be limited to the profile record, and the payout can be locked for good. A found hole was fixed on chain before building on it: the registrar wallet had all roles on the `stenmont.eth` registry and could have re-pointed a name to a new resolver to dodge the payout lock; it now holds only the register role. Second find: Tenderly's public gateway rate-limits reads from Workers (429), so ENS reads fall back to a second provider.
- 11:05 Worked in parallel with four agents, each in separate files and none allowed to commit or deploy: an Opus 5.5 reviewer (read-only), a World ID and Agent Pass module builder, an x402 facilitator builder, and a Phase 7 contracts builder. The review is saved in `plan/review-opus-1.md`.
- 11:05 World ID module (`services/api/src/world`, 52 tests) and x402 facilitator (`services/facilitator`, 21 tests) are built and tested locally only, not yet wired into routes or deployed, and not run against live services. The World module's RP signature layout was written from memory because the skill docs only link out to it; it must be checked against World's own library before it is trusted.
- 11:05 ENS feedback additions: reads from Workers hit the shared gateway's rate limit; the deployed resolver and main branch differ in the permission model (per key vs per node).
- 11:40 Phase 7 contracts built by a parallel agent and verified here: `InvestorRegistry` (investor allowlist by attester signature, expiry, revoke, block list), `InvoiceClaim` (an ERC-721 claim on a listed invoice: an allowlisted investor funds it at a discount in USDT, the merchant gets the advance at once, the router's payout hook pays the holder when the customer pays, settlement and a default path after 7 days; transfers only between allowlisted holders and frozen once settled) and `ReputationRegistry`. 249 contract tests pass (71 claim unit, fuzz at 1,000 runs, a handler-driven invariant run of 25,600 calls, 17 fork tests against the real USDT passed per the agent). Not deployed, not yet audited with the Pashov and Trail of Bits skills.
- 11:40 Two changes to EXISTING contracts the agent asked for and did not make: (1) `PaymentRouter.cancel` must revert once an invoice has been sold (hook set), or a merchant can cancel after selling and strand the investor; (2) wiring reputation (the router calling `ReputationRegistry.record` on full payment). Both need a router redeploy, so they are queued with the review fixes. Deploy order: router first, then `DeployFinancing`.
- 12:30 Review fixes, API side (255 API tests, live on staging with the auth and dashboard runs passing): invoice creation rate limits, refund approval threshold counted across split refunds, renewal leases, host-only session cookie, no re-broadcast on "already known", idempotency keys bound to the request, API keys can be made and revoked from Settings, one passkey per business, webhook endpoint cap. The contract-side fixes are with a parallel agent. Status is in `plan/review-opus-1.md`.
- 13:10 Review fixes, contract side (parallel agent, verified here: 269 forge tests): no cancelling an invoice after it is sold; refund approval threshold counts the whole invoice; merchant cancel of a subscription by signature (works for passkey accounts); optional payer reputation recording that cannot block a payment; stronger router invariants with an attacker. Not deployed: staging still runs the old contracts, so the next deployment must redeploy the router, subscription manager and the new financing contracts together, regenerate the shared ABIs, and point the API at the new addresses.
- 13:10 World: the RP request signature layout matches World's own idkit-server source (read, not executed: running downloaded code was blocked, correctly). Test added that rebuilds the layout independently.

---

## Staging redeploy after the review (Whitechain Testnet 1874): current addresses (all verified on the explorer)

- PaymentRouter: https://explorer.testnet.whitechain.io/address/0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0
- SubscriptionManager: https://explorer.testnet.whitechain.io/address/0x0e22748d63717D51eE8DFa5A62413A11dda981cF
- InvestorRegistry: https://explorer.testnet.whitechain.io/address/0x6b8490a893c860888f65ce410b0b287ca1c9b8fa
- InvoiceClaim: https://explorer.testnet.whitechain.io/address/0x2eb9aaf14a2d729bc3f185a144571fcd23454914
- ReputationRegistry: https://explorer.testnet.whitechain.io/address/0x751165c1e587637af6ec0ff91b87fa7bd08a9ed5
- PasskeyAccountFactory (unchanged): https://explorer.testnet.whitechain.io/address/0x5101c37647581c81b462436af2D7ac8ccD08D33A
- The earlier router and subscription manager are kept as `staging_retired` in `contracts/deployments/1874.json`.

---

- 13:50 Staging redeployed with the review fixes: new router and subscription manager, plus the three financing contracts (investor allowlist, invoice claim, reputation registry), all verified on the explorer. The router now points at the reputation registry and is registered as a recorder (checked on chain). The API and web point at the new addresses (shared ABIs regenerated, the export script now includes the financing contracts). Old staging invoices belong to the retired router and are not shown by the indexer any more.
- 13:50 Live regression on the new contracts, all passing: SDK checkout with return link and export (1.0 min), dashboard with the first refund on the new router (2.1 min), subscription with two renewals and a customer cancel (2.1 min, 29 s), and the example shop after re-provisioning its business (new delegation, new key and webhook secret, stored only in Cloudflare).
- 13:50 Still on the old trust model by design: the shared relayer can create invoices for any delegating merchant (review item 4) and the deployer is still the owner of every contract (multisig planned at the end).
