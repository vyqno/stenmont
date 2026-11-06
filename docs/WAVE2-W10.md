# W10 bounded security pass

Status: partial review with narrow fixes. Not a professional audit, clean Slither result, or production-readiness sign-off. No deploy, push, chain broadcast, account creation, real provider call, email or wallet funding was performed.

## Verified fixes

- 20:05 IST: Public-store inventory now stays reserved while an earlier invoice can still be paid. Hosted expiry is not onchain cancellation. Release requires a confirmed cancelled router invoice with zero payment and no hook, matching cancelled/zero local state, and no indexed or in-flight payment records. Unknown, failed, hosted-expired and partially paid invoices retain stock for reconciliation. No automatic cancellation was introduced.
- 20:05 IST: Investor and subscription clients no longer call the platform faucet. Insufficient owned USDT stops before signing or submitting a payment. Remainder-first plans compare the exact first segment, not the full plan total. The manual faucet API was untouched.

## What ran

- Stock regression observed RED (two failures), then `pnpm --filter @stenmont/api test test/catalog/checkout.test.ts test/catalog/storeCheckout.test.ts test/installCleanup.test.ts --maxWorkers=1`: **40 passed**. API `tsc --noEmit` passed. Cases cover late payment, cancelled-onchain release once, hosted expiry, RPC failure, partial payment, hook and pending relay work.
- Autofunding regression observed RED (three failures), then `pnpm --filter @stenmont/web test test/noAutofunding.test.tsx test/subscribe.test.ts test/financing.test.ts --maxWorkers=1`: **20 passed**. Web typegen/TypeScript and changed-file ESLint passed. React callbacks and fetch/signature fixtures exercise actual client paths; this is not browser/live proof. A funded first-segment control still signs the two agreements and permit.
- `pnpm audit --json` completed with **five advisories: one high, three moderate, one low**. The high advisory concerns the transitive glob CLI command option, not a demonstrated Worker exploit. No major dependency upgrades were applied.
- Reachable Git-history pattern scan examined **1,791 blobs**: zero private-key PEM headers or selected vendor-token-shaped strings, and no tracked dotenv value files. This is a heuristic check, not proof that no secret can exist. No credential values were read or printed.
- A scoped API scan at base `62f1769` recorded the stock-lifecycle finding and partial coverage. It used sequential review, without independent workers. Its sealed result describes the original revision; fixes are separate commits. Token measurement was unavailable.

## Audit scope and remaining work

Reviewed source boundaries included centralized authentication, OAuth grant checks, account HMAC receipts, runtime provider destinations/budgets/tool allowlists, A2A merchant/skill checks, Shopify callback binding, site probes and checkout inventory. Other API files were not exhaustively audited. Site/webhook egress and deployment-specific SSRF assumptions need follow-up.

Pashov, x-ray, Trail of Bits and Slither skill files were not found in the inspected installed-skill roots. No external audit or contract activation is claimed. W1's existing Solidity coverage/static-analysis gates remain open.

Not run: a full workspace rerun, browser tests, CSP/header rollout, relayer receipt-timeout reconciliation, scheduled install cleanup, dependency upgrades, all-contract security review or any live acceptance. The lead owns integration checks and release.

Dependency advisories: [esbuild dev-server requests](https://github.com/advisories/GHSA-67mh-4wv8-2f99), [glob CLI command option](https://github.com/advisories/GHSA-5j98-mcp5-4vw2), [esbuild Windows dev-server file reads](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr), [glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). Exploitability in deployed paths was not established.
