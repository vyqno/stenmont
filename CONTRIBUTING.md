# Contributing

Thanks for looking at Stenmont. This is how work is done here.

## Setup

```bash
nvm use                      # Node 26.13.0 (see .nvmrc)
corepack enable && pnpm install
cp .env.example .env         # paste test values only; never commit .env
```
Contracts need [Foundry](https://getfoundry.sh) (`forge soldeer install` inside `contracts/`).

## Checks that must pass

```bash
pnpm -r lint && pnpm --filter @stenmont/web typecheck && pnpm -r test
cd contracts && forge fmt --check && forge build && forge test
node contracts/script/export-shared.mjs   # must leave packages/shared/src unchanged
```
The same checks run in CI on every pull request.

## How we work

- **Tests first.** Write the failing test, then the code. Money code also gets fuzz and invariant tests.
- **One branch per phase** (`phase-N-name`), small commits, pull request into `main`. Merge only when CI is green.
- **Commit messages** are one short conventional line: `feat(api): add refunds`, `fix(contracts): block cancel after sale`, `docs: ...`. No trailers.
- **Environments:** local first, then staging, then production. Production is deployed only with an explicit go-ahead; the production scripts refuse to run without `STENMONT_CONFIRM_PRODUCTION=yes`.
- **Secrets** go in Cloudflare (`wrangler secret`), never in code, config or git.
- **Versions:** use the latest stable releases and check them (`npm view`), do not copy old examples.
- Generated files (`packages/shared/src/abis`, `addresses.ts`) come from `contracts/script/export-shared.mjs`; do not edit them by hand.

## Pull requests

Describe what changed and how you tested it. Keep a pull request to one idea. Security-sensitive changes (contracts, signing, sessions, money paths) need a second reviewer.
