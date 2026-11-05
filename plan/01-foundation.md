# Phase 1: Foundation

**Goal:** an empty but real repo that builds, tests and deploys something at every layer.
**Tech:** pnpm 12 workspace, TypeScript 7, Foundry, Hono on Workers, D1 + Drizzle, Next.js 16 via `@opennextjs/cloudflare`.
**Done when:** `pnpm -r test` and `forge test` pass locally and in CI, and `https://api.stenmont.com/health` returns `{"ok":true}`.

## Global constraints

Versions and rules in [README.md](README.md). Re-check versions with `npm view` before installing.

## Review focus

1. Money helpers with more than 6 decimals, empty string, negative: must throw, never round silently.
2. `invoiceId` for the same merchant and number: identical on every call; different number: different id.

### Task 1.1: Workspace skeleton

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc` (`26.13.0`), `.env.example`, `.editorconfig`
**Produces:** workspace globs `packages/*`, `services/*`, `apps/*`; root scripts `build`, `test`, `lint`; `"engines": {"node": ">=26.13.0"}`.

- [x] Create the files; `.env.example` lists every key named in Phase 0 with empty values
- [x] Run `pnpm install` → completes with no errors
- [x] Run `pnpm -r test` → exits 0 (no suites yet)
- [x] Add the commit line to `commits.md`: `build: add pnpm workspace skeleton`

### Task 1.2: `packages/shared`

**Files:** Create `packages/shared/src/{brand,chains,money,ids,eip712,index}.ts`, `packages/shared/test/{money,ids,eip712}.test.ts`
**Produces:**
- `brand.ts`: `BRAND_NAME = "Stenmont"`, `BRAND_DOMAIN = "stenmont.com"`, `BRAND_ENS = "stenmont.eth"`
- `chains.ts`: `whitechainSepolia: Chain` (viem `defineChain`, id 1874, RPC above, explorer above), `USDT_ADDRESS: Address`, `USDT_DECIMALS = 6`
- `money.ts`: `toUnits(s: string): bigint`, `fromUnits(n: bigint): string`, `formatUSDT(n: bigint): string` (e.g. `"$12.50"`)
- `ids.ts`: `invoiceId(merchant: Address, number: string): Hex` = `keccak256(encodeAbiParameters([{type:"address"},{type:"string"}], [merchant, number]))`
- `eip712.ts`: `usdtDomain: TypedDataDomain`, `receiveAuthTypes`, `buildReceiveAuth(args: {from, to, value, validAfter, validBefore, nonce}) → {domain, types, primaryType, message}`

- [x] Write failing tests: `toUnits("12.50") === 12500000n`; `fromUnits(12500000n) === "12.5"`; `toUnits("1.1234567")` throws; `toUnits("")` throws; `toUnits("-1")` throws; `invoiceId(a,"INV-1") === invoiceId(a,"INV-1")` and `!== invoiceId(a,"INV-2")`
- [x] Add a test that `hashDomain(usdtDomain)` equals the on-chain `DOMAIN_SEPARATOR` recorded in Phase 0 Task 0.1
- [x] Run `pnpm --filter @stenmont/shared test` → FAIL (functions missing)
- [x] Implement the signatures above; `toUnits` parses with a strict regex `^\d+(\.\d{1,6})?$`
- [x] Run the tests → PASS
- [x] Commit line: `feat: add shared chain, money and id helpers`

### Task 1.3: Foundry project

**Files:** Create `contracts/foundry.toml`, `contracts/src/Version.sol`, `contracts/test/Version.t.sol`, `contracts/remappings.txt`
**Config:** `solc = "0.8.38"`, `via_ir = true`, `evm_version = "cancun"`, `optimizer_runs = 200`; install `forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 foundry-rs/forge-std`.

- [x] Failing test `test_versionIsOne()` asserting `Version.VERSION() == 1`
- [x] Run `cd contracts && forge test` → FAIL (contract missing)
- [x] Add `Version.sol`; run `forge test` → PASS (1 test)
- [x] Commit line: `build: add Foundry project`

### Task 1.4: API Worker and D1

**Files:** Create `services/api/{package.json,wrangler.jsonc,src/index.ts,src/db/schema.ts,drizzle.config.ts,test/health.test.ts,migrations/0000_init.sql}`
**Produces:** `GET /health → {"ok":true}`; tables `merchants(id, name, ens_name, payout_address, created_at)`, `api_keys(id, merchant_id, prefix, hash, scopes, created_at, revoked_at)`, `audit_log(id INTEGER PK AUTOINCREMENT, merchant_id, actor, action, payload, created_at)`, `idempotency_keys(key, merchant_id, response, created_at, PRIMARY KEY(key, merchant_id))`. Timestamps are ISO-8601 TEXT.

- [x] Create the D1 database: `npx wrangler d1 create stenmont-db` (Claude runs it); put the id in `wrangler.jsonc`
- [x] Failing test: `GET /health` returns 200 and `{ok:true}` (uses `app.request`; migration tests use `node:sqlite`, no Workers test pool needed yet)
- [x] Run `pnpm --filter @stenmont/api test` → FAIL
- [x] Implement `src/index.ts` (Hono app, `export default app`); generate and apply the migration: `pnpm drizzle-kit generate` then `npx wrangler d1 migrations apply stenmont-db --remote`
- [x] Test that inserting then updating an `audit_log` row is refused by a trigger created in the migration (append-only): `UPDATE audit_log …` raises
- [x] Deploy to **staging** first: `wrangler deploy --env staging` (route `api-staging.stenmont.com`, own D1 database). Production deploy only when approved: `STENMONT_CONFIRM_PRODUCTION=yes pnpm deploy:production`
- [x] Run `curl -s https://api-staging.stenmont.com/health` → `{"ok":true}`
- [x] Commit line: `feat: add API worker with health check and D1 schema`

### Task 1.5: Web app shell

**Files:** Create `apps/web/` (Next.js 16 App Router + Tailwind 4), `apps/web/open-next.config.ts`, `apps/web/wrangler.jsonc`, `apps/web/app/page.tsx`

- [x] Scaffold with `pnpm create next-app@latest apps/web`; add `@opennextjs/cloudflare`
- [x] Landing page renders the product line from `README.md`; a render test expects text "settled in seconds" (Playwright arrives in Phase 3)
- [x] Deploy to **staging**: `pnpm deploy:staging` (`app-staging.stenmont.com`). Production only when approved. Do not enable `cacheComponents` (it hangs on Workers)
- [x] `curl -sI https://app-staging.stenmont.com` → `200`
- [x] Commit line: `feat: add Next.js web shell on Cloudflare`

### Task 1.6: CI

**Files:** Create `.github/workflows/ci.yml`; modify `apps/web/eslint.config.mjs`, `contracts/foundry.toml` (`[fmt]`)

- [x] Workflow with actions pinned to commit SHAs: `typescript` (install frozen, lint, web typecheck, tests), `contracts` (soldeer install, `forge fmt --check`, build, test), `web-build` (OpenNext build), and a weekly or manual `fork` job against the real USDT
- [x] Every CI command run locally and green (`pnpm -r lint`, typecheck, `pnpm -r test`, `forge fmt --check`, `forge build`, `forge test`, `pnpm --filter @stenmont/web build:cf`)
- [ ] After the first push the Actions tab shows all jobs green
- [ ] Commit line added to `commits.md`

### Task 1.7: Repository standards (so the repo reads as one coherent piece of engineering)

**Files:** Create `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/adr/0001-cloudflare-d1.md`, `docs/adr/0002-durable-object-relayer.md`, `docs/adr/0003-payment-nonce-bound-to-invoice.md`, `.github/{dependabot.yml,pull_request_template.md,CODEOWNERS}`, `commitlint.config.js`, `lefthook.yml`, `.prettierrc`; modify `README.md` (badges, diagram, quickstart)

- [ ] `LICENSE` (MIT; the vendored Tether code stays Apache-2.0 with its own header)
- [ ] `CONTRIBUTING.md`: Conventional Commits with scopes (`feat(contracts):`, `fix(api):`, `docs:`, `build:`, `test:`, `chore:`), one branch per phase (`phase-N-name`) merged to `main` by pull request, squash never (keep the atomic history)
- [ ] `commitlint` plus `lefthook` pre-commit: `forge fmt --check`, `prettier --check`, `pnpm -r lint`, `pnpm -r test`, and a commit-msg check. A bad message or failing test blocks the commit locally
- [ ] CI (Task 1.6) required on `main`; add a coverage and a `forge snapshot` gas check
- [ ] `docs/ARCHITECTURE.md`: one diagram (contracts, Workers, D1, relayer, indexer, ENS, World), the trust boundaries, and the money flow
- [ ] ADRs for each decision already made (D1 over Postgres, Durable Object relayer, nonce derived from invoice id, passkey accounts, Cron indexer), one page each: context, decision, consequences
- [ ] `SECURITY.md`: threat model summary, how to report, and an `audits/` folder that receives the Pashov and Trail of Bits reports and our fixes
- [ ] `contracts/deployments/<chainId>.json` is the single source of truth for addresses; README, SDK and API read from it (CI fails if they drift)
- [ ] A link and spelling check in CI (broken links, "onchain" not "on-chain", brand name `Stenmont`)
- [ ] Tag a release at the end of each phase (`v0.1.0` after Phase 1) with notes
- [ ] Commit lines added to `commits.md`

### Task 1.8: CD on Cloudflare (staging automatic, production gated)

**Goal:** a merge to `main` deploys staging; production deploys only when you fast-forward `release`. No Cloudflare token lives in GitHub, and secrets stay in Cloudflare.

**Model**

| Event | What runs | Where |
|---|---|---|
| Pull request | CI (`ci.yml`): lint, typecheck, tests, forge, web build | GitHub Actions, no secrets |
| Merge to `main` | Cloudflare Workers Builds deploys `stenmont-api-staging` and `stenmont-web-staging` | Cloudflare |
| Fast-forward `release` from `main` (you, after checking staging) | Workers Builds deploys `stenmont-api` and `stenmont-web` | Cloudflare |

**Files:** Create `docs/DEPLOYMENT.md` (this model, rollback, migration rules)

- [ ] Create the GitHub repo under the `stenmont` org and install Cloudflare's GitHub app on it (**you**, one time, dashboard)
- [ ] Protect `main`: pull request required, status checks `typescript`, `contracts`, `web-build` required and up to date, force pushes blocked, no squash (**you**, repo settings)
- [ ] Protect `release`: only you can push; fast-forward only
- [ ] Workers Builds for `stenmont-api-staging`: production branch `main`, root directory `services/api`, build command `pnpm install --frozen-lockfile`, deploy command `pnpm deploy:staging`
- [ ] Workers Builds for `stenmont-web-staging`: production branch `main`, root directory `apps/web`, deploy command `pnpm deploy:staging`
- [ ] Workers Builds for `stenmont-api` and `stenmont-web`: production branch `release`, deploy command `pnpm deploy:production`, and a build variable `STENMONT_CONFIRM_PRODUCTION=yes` set only on these two (the second gate; the scripts refuse without it)
- [ ] Turn off preview builds for non-production branches, so a pull request never touches the staging database
- [ ] Migration rule written in `docs/DEPLOYMENT.md`: migrations run before the new code, so every migration must work with the old code too (add columns first, remove later)
- [ ] Rollback written down: `wrangler rollback --env production` for code, D1 Time Travel for data
- [ ] Verify: a merge to `main` shows the new version on `api-staging.stenmont.com` within minutes; the production URL does not change until `release` moves
- [ ] Commit lines added to `commits.md`
