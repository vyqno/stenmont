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

- [ ] Create the files; `.env.example` lists every key named in Phase 0 with empty values
- [ ] Run `pnpm install` → completes with no errors
- [ ] Run `pnpm -r test` → exits 0 (no suites yet)
- [ ] Add the commit line to `commits.md`: `build: add pnpm workspace skeleton`

### Task 1.2: `packages/shared`

**Files:** Create `packages/shared/src/{brand,chains,money,ids,eip712,index}.ts`, `packages/shared/test/{money,ids,eip712}.test.ts`
**Produces:**
- `brand.ts`: `BRAND_NAME = "Stenmont"`, `BRAND_DOMAIN = "stenmont.com"`, `BRAND_ENS = "stenmont.eth"`
- `chains.ts`: `whitechainSepolia: Chain` (viem `defineChain`, id 1874, RPC above, explorer above), `USDT_ADDRESS: Address`, `USDT_DECIMALS = 6`
- `money.ts`: `toUnits(s: string): bigint`, `fromUnits(n: bigint): string`, `formatUSDT(n: bigint): string` (e.g. `"$12.50"`)
- `ids.ts`: `invoiceId(merchant: Address, number: string): Hex` = `keccak256(encodeAbiParameters([{type:"address"},{type:"string"}], [merchant, number]))`
- `eip712.ts`: `usdtDomain: TypedDataDomain`, `receiveAuthTypes`, `buildReceiveAuth(args: {from, to, value, validAfter, validBefore, nonce}) → {domain, types, primaryType, message}`

- [ ] Write failing tests: `toUnits("12.50") === 12500000n`; `fromUnits(12500000n) === "12.5"`; `toUnits("1.1234567")` throws; `toUnits("")` throws; `toUnits("-1")` throws; `invoiceId(a,"INV-1") === invoiceId(a,"INV-1")` and `!== invoiceId(a,"INV-2")`
- [ ] Add a test that `hashDomain(usdtDomain)` equals the on-chain `DOMAIN_SEPARATOR` recorded in Phase 0 Task 0.1
- [ ] Run `pnpm --filter @stenmont/shared test` → FAIL (functions missing)
- [ ] Implement the signatures above; `toUnits` parses with a strict regex `^\d+(\.\d{1,6})?$`
- [ ] Run the tests → PASS
- [ ] Commit line: `feat: add shared chain, money and id helpers`

### Task 1.3: Foundry project

**Files:** Create `contracts/foundry.toml`, `contracts/src/Version.sol`, `contracts/test/Version.t.sol`, `contracts/remappings.txt`
**Config:** `solc = "0.8.38"`, `via_ir = true`, `evm_version = "cancun"`, `optimizer_runs = 200`; install `forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 foundry-rs/forge-std`.

- [ ] Failing test `test_versionIsOne()` asserting `Version.VERSION() == 1`
- [ ] Run `cd contracts && forge test` → FAIL (contract missing)
- [ ] Add `Version.sol`; run `forge test` → PASS (1 test)
- [ ] Commit line: `build: add Foundry project`

### Task 1.4: API Worker and D1

**Files:** Create `services/api/{package.json,wrangler.jsonc,src/index.ts,src/db/schema.ts,drizzle.config.ts,test/health.test.ts,migrations/0000_init.sql}`
**Produces:** `GET /health → {"ok":true}`; tables `merchants(id, name, ens_name, payout_address, created_at)`, `api_keys(id, merchant_id, prefix, hash, scopes, created_at, revoked_at)`, `audit_log(id INTEGER PK AUTOINCREMENT, merchant_id, actor, action, payload, created_at)`, `idempotency_keys(key, merchant_id, response, created_at, PRIMARY KEY(key, merchant_id))`. Timestamps are ISO-8601 TEXT.

- [ ] Create the D1 database: `npx wrangler d1 create stenmont-db` (Claude runs it); put the id in `wrangler.jsonc`
- [ ] Failing test with `@cloudflare/vitest-pool-workers`: `GET /health` returns 200 and `{ok:true}`
- [ ] Run `pnpm --filter @stenmont/api test` → FAIL
- [ ] Implement `src/index.ts` (Hono app, `export default app`); generate and apply the migration: `pnpm drizzle-kit generate` then `npx wrangler d1 migrations apply stenmont-db --remote`
- [ ] Test that inserting then updating an `audit_log` row is refused by a trigger created in the migration (append-only): `UPDATE audit_log …` raises
- [ ] Deploy: `npx wrangler deploy`; route `api.stenmont.com` to the Worker (custom domain in `wrangler.jsonc`)
- [ ] Run `curl -s https://api.stenmont.com/health` → `{"ok":true}`
- [ ] Commit line: `feat: add API worker with health check and D1 schema`

### Task 1.5: Web app shell

**Files:** Create `apps/web/` (Next.js 16 App Router + Tailwind 4), `apps/web/open-next.config.ts`, `apps/web/wrangler.jsonc`, `apps/web/app/page.tsx`

- [ ] Scaffold with `pnpm create next-app@latest apps/web`; add `@opennextjs/cloudflare`
- [ ] Landing page renders the product line from `README.md`; a Playwright smoke test `GET /` expects text "settled in seconds"
- [ ] Deploy with the OpenNext build + `wrangler deploy`; custom domain `app.stenmont.com`
- [ ] `curl -sI https://app.stenmont.com` → `200`
- [ ] Commit line: `feat: add Next.js web shell on Cloudflare`

### Task 1.6: CI

**Files:** Create `.github/workflows/ci.yml`

- [ ] Workflow: checkout, setup Node from `.nvmrc`, `pnpm install --frozen-lockfile`, `pnpm -r test`, install Foundry, `forge test` in `contracts/`
- [ ] Push is by you; after the first push the Actions tab shows green
- [ ] Commit line: `build: add CI for TypeScript and Foundry tests`
