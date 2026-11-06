# W11 clean-clone and seed readiness

## 20:10 IST · 2026-11-06

A new isolated local clone followed the public README first, with no copied `.env`, private handoff files or secret values. Existing package caches were reused; this was not a test of a machine with an empty package cache.

- Initial `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS`. Narrow workspace allowances for the actual required `esbuild` and `workerd` scripts fixed it. Frozen offline installation then passed without dependency or lockfile upgrades.
- Public README now separates secretless checks from real-chain credentials and includes the actual local migration command. It corrects unsupported invoice wildcard, lost-passkey recovery and zero-held-funds claims.
- `forge fmt --check` initially failed on 12 v2 test files. Only those files were formatted, in separate small commits; no Solidity production source changed. Fresh Soldeer install, final format check and `forge build` passed. Compiler/lint warnings remain; no clean-audit claim.
- Legacy ABI/address export ran and produced no shared-source diff. Targeted acknowledgement/claim funding, settlement and default suite: 10 passed. Full 450 Foundry suite was not repeated after formatting.

## Exact workspace checks

One serialized full workspace invocation, with `VITEST_MAX_WORKERS=1`: **1,613 tests passed**. API 1,061; web 247; shared 61; MCP 20; agent 52; SDK 14; React 3; x402 15; facilitator 31; install-proof 57; example-store 10; scripts 27 Vitest + 15 Node tests.

`pnpm -r --workspace-concurrency=1 lint`, web typecheck and Cloudflare bundle build passed in the same clean clone under the shared lock. Existing web unused-import warning and compiler/Vite warnings were not suppressed. GitHub's four pinned CI action commit IDs were read through its API and all exist. No remote GitHub Actions run or push was performed, so this is local evidence, not a green remote CI badge.

Actual host runtime was Node 26.8.1 and pnpm 12.16.1. The repository pin remains Node 26.13.0; registry lookup confirmed that version exists, but these checks did not run under it. No global runtime was changed.

## Local development regression

Local D1 migration application through 0060 succeeded without credentials. Starting Wrangler then exposed GET /health returning 500 because the middleware eagerly initialized a chain signer before the static liveness route. A new test reproduced the failure; the route now precedes credential-dependent middleware. Existing health/404 tests were retained. Final health/auth targeted checks: 7 passed; API TypeScript passed. A fresh actual local Wrangler request returned 200 and `{"ok":true}`. Its owned process group was stopped afterward. This is static liveness, not proof of database/chain/provider readiness.

The full 1,613 run predates this narrow liveness fix. Final targeted 7 tests and API typecheck cover it; no second full workspace invocation was run.

## Seed and migration policy

`pnpm --filter @stenmont/scripts seed-demo` ran as a no-network dry-run. Five local regression tests cover staging-only origin, stable merchant/resource keys, canonical price responses, existing catalogue mismatch, restart without duplicate resources, fresh actual status after cached creation replay, and uncertain-send refusal. The replay regression was mutation-checked: removing the fresh read fails, restoring it passes.

The helper can create products, real open/past-due invoices, a B2B instalment offer and an ordinary subscription offer through the authenticated public API. It does not fabricate paid/partial/funded statuses, activate agreements, create a business without a passkey or bypass ENS/World/funding. Those actions and a real two-run staging seed remain not run. See [SEED.md](SEED.md).

The numbered SQL files remain authoritative; stale Drizzle metadata through 0016 is documented rather than regenerated as fictional history. See [MIGRATIONS.md](MIGRATIONS.md).

No staging deployment, remote D1 mutation, account creation, funding, email, provider call or publication was performed by W11. The lead owns final integration and live proof.
