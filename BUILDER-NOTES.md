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
