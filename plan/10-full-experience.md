# Full Experience Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Continue within the authorized scope; human identity, funding and irreversible external actions have explicit gates below.

**Goal:** A stranger can onboard a business, sell, pay, check records, reconcile books, manage identity and finance an invoice unaided on staging.

**Architecture:** Extend the existing Next.js dashboard and Hono API, using D1 for tenant-scoped records and the existing relayer for transactions. Keep contract deployment addresses and generated shared ABIs authoritative. Use real Whitechain testnet USDT, Sepolia ENS and World services for live acceptance; mocks belong only in local tests.

**Tech stack:** Existing pnpm workspace, Next.js 16, React, Hono, Drizzle/D1, viem, Foundry and Cloudflare Workers. Check current stable releases when a phase starts; do not introduce unrelated dependency upgrades.

**Spec:** [Space analysis](analysis-whitechain-space.md), [sponsor requirements](../PS.md), [real-world scope](09-real-world.md), [contracts](contracts.md), [architecture](../docs/ARCHITECTURE.md). Detailed progress notes take precedence over stale phase summary status.

## Global constraints

- Work on `chatgpt-work-3`, descended from `integration/next` and `integration/clean`; no worktrees, destructive Git, push or merge to main.
- Staging only. No production deployment, production migration or production-confirmation variable.
- Leave `.gitignore`, `brand-guidelines/dev-docs-ui-ref/` and `brand-guidelines/landing-page-ref/` untouched; stage explicit paths only.
- Keep private handoff material, `.env`, secrets and `commits.md` out of commits. Never print secret values or put them in browser screenshots.
- Expected network configuration, pending current-source verification: chain `1874`, RPC `https://rpc.testnet.whitechain.io`, explorer `https://explorer.testnet.whitechain.io`, official USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, 6 decimals.
- Money uses integer base units internally; validate at the API boundary. Every money mutation must be idempotent and audited.
- No emails/messages, account creation, npm publishing, GitHub push or multisig transaction without explicit authorization. Automated isolated staging test fixtures must not use the owner's personal identity.
- For a completed slice: write failing tests, observe failure, implement, run targeted and full checks, deploy staging, verify real services, run Aside, inspect diff, record real IST time, tick only proven checks and make a small conventional commit.
- Run `aside guide` before first browser use. Ask before installation if absent. Never extract browser credentials or perform the user's World verification.
- Pause for a real World sign-in, additional test funds, the multisig address, unavailable credentials or an external permission requirement; report independent work accurately.

## Review focus

1. A stale name-availability response must not enable a claim for a different label; concurrent claims need a clear conflict and retry path (I1).
2. A customer must never read another payer's payments through an address supplied in a URL or body (I2).
3. Replayed or changed approvals, webhook deliveries and funding requests must not execute money movement twice (I4, D, E).
4. A refresh or closed tab during an onchain action must recover confirmed state without displaying an invented success (I1, A, F).
5. Rounded currency, partial refunds and partial payments must preserve balances and export totals across a period boundary (I2, I9, D).

## Planning and network gate

- [x] Verify the working branch and preserve existing user changes.
- [x] Write the speaker analysis and asked/built/missing table.
- [x] Write this ordered plan with named tests and staging gates.
- [x] Verify chain ID, RPC, explorer, official token address and current Whitechain/World/ENS requirements from primary sources; see the analysis document for links retrieved 2026-11-06. No configuration mismatch found.
- [x] Revalidated 6 token decimals by direct `cast call` to the configured Whitechain testnet RPC on 2026-11-06.
- [x] Run baseline `pnpm test` and `pnpm lint`: tests pass (API 330, web 22); lint exits successfully with one existing unused-import warning in `world-enrol.spec.ts`.

## Current build order (owner instruction, 2026-11-06)

- [x] Split the existing Identity work into small local commits after checking each staged diff. Full suite: 497 passed; lint exits 0 with one existing warning; local browser integration: 1 passed.
- [ ] Agent install: copyable prompt, llms.txt, MCP OAuth 2.1 with PKCE, connection status, enforced live/paused state and separate test/live modes. Staging remains the deployment environment for both mode tests.
- [ ] Customer page with authenticated records and receipts.
- [ ] Live tokenization lifecycle with independently verified explorer receipts.
- [ ] Pay from an existing wallet using the payer's own USDT.
- [ ] Books depth: reconciliation, another export format and tax lines.
- [ ] Minimal storefront.

The owner authorized isolated staging test businesses using the Playwright virtual authenticator; keep runs low, use no real funds, never create third-party accounts, and report creations. Real World verification and additional test funds remain owner handoffs.

## Part I: implementation and acceptance detail

### I1. ENS dashboard (first implementation slice)

**Current verification, 2026-11-06:** API availability/resolution and agent-input tests observed RED then GREEN; World callback return-path test observed RED then GREEN. Full TypeScript suite: 497 passed (API 335, web 26); lint exits 0 with the pre-existing unused-import warning; web typecheck exits 0; Cloudflare web build passes. The local API-double Chromium test now passes after narrowing an ambiguous alert selector. API and web Workers were deployed directly to staging; API health and the web Identity route return 200, and unauthenticated availability returns 401. The live Identity Playwright test passed once in 3.7 minutes: real ENS claim/resolution, finance grant, permanent lock, approval-required gate, agent creation/resolution/revocation and mobile width. Real World approval completion and Aside evidence remain **not run**, so this slice is not complete. The owner authorized small local Identity commits on 2026-11-06; pushes remain prohibited.

**Files:** `apps/web/app/dashboard/identity/page.tsx` (new), `apps/web/app/dashboard/DashboardShell.tsx`, `apps/web/lib/identity.ts` (new), `services/api/src/routes/ens.ts`, `services/api/src/ens/client.ts`; extend `services/api/test/ens.test.ts`; add `apps/web/test/identity.test.ts` and `apps/web/e2e/identity.spec.ts`.

**Interface:** Reuse authenticated `/v1/ens/name`, `/claim-name`, `/finance`, `/lock-payout` and `/agents` routes. Add tenant-authenticated read-only availability/resolution endpoints using the existing ENS client; report live results rather than fabricated addresses. Preserve provider fallback and publicnode sends.

- [x] Write failing API tests: invalid/reserved/taken labels; provider-driven resolution; tenant isolation; RPC failure returns a retryable error and never a false availability result. These local tests use an ENS test double; live acceptance remains separate.
- [ ] Write failing web tests: validation, stale availability, exact agent-limit approval parameters and API errors. Add browser assertions for visible claim, resolution, finance role, permanent-lock confirmation, create/list/revoke agent, invalid input and reload recovery.
- [ ] Run targeted tests and observe the expected failures before implementation.
- [x] Run the authorized live Identity browser acceptance once on staging (1 passed, 3.7 minutes; one isolated test business).
- [x] Add Identity navigation and screen: availability → claim → resolution; finance member limited to `stenmont.profile`; explain members must be added before permanent payout lock; require explicit confirmation. Agent form exposes limits, scopes, expiry, context and endpoint; over 100 USDT daily routes to World approval.
- [ ] Run targeted tests, `pnpm test`, `pnpm lint` and web typecheck/build. Run the staging identity flow against Sepolia; resolve business and agent records independently; verify revocation and protected payout behavior. Complete Aside evidence and the shared completion gate.

### I2. Customer account and records

**Files:** new `services/api/src/routes/customer.ts`, auth/schema and next numbered migration as needed, new `apps/web/app/customer/` pages and customer helper; tests `services/api/test/customer.test.ts`, `apps/web/test/customer.test.ts`, `apps/web/e2e/customer.spec.ts`.

- [ ] Write failing tests: signed single-use challenge/session identifies the payer; arbitrary-address access and replay are rejected; only that payer's payments/refunds/subscriptions appear; partial refunds conserve totals; cancel requires the payer's signature.
- [ ] Implement passkey sign-in or a scoped expiring signed handoff from successful checkout, customer history, receipts and subscription cancel using the existing signature flow. URLs are not authorization by themselves.
- [ ] Add plain-language copy, receipt downloads, empty/loading/error states and links from payment/subscription confirmation.
- [ ] Verify payment → history → refund → history → subscription → cancel on real staging; test mobile and keyboard access; complete the shared gate.

### I3. README qualification evidence

**Files:** `README.md`, `DEMO.md`; reuse existing checkout scripts/specs.

- [ ] Add who pays gas, relayer WBT source and drain protections; add why Proof of Human is proportionate and what it does not prove.
- [ ] Run a fresh payment on the currently configured router, verify its transaction receipt and official-USDT transfer, and add that explorer link. Never reuse a retired-router link as current evidence.
- [ ] Check documentation commands and evidence URLs; complete the shared gate without treating documentation as a new runtime feature.

### I4. Live financing lifecycle

**Files:** `apps/web/e2e/financing.spec.ts`, `scripts/financing-lifecycle.ts` (new if needed), `README.md`, `DEMO.md`, `plan/07-financing.md`.

- [ ] Inspect existing claim/registry tests; add failing coverage only for an uncovered lifecycle or replay boundary.
- [ ] Prepare seller listing with both passkey signatures, investor World/allowlist, discounted USDT funding, customer payment, holder payout and settlement; independently compare balances/events and save explorer links.
- [ ] Hand off exact World verification link when a verified person is required. If using the authorized test-attester alternative, label its World bypass prominently and never claim real human verification.
- [ ] Show default after the real contract grace period on a pinned fork if live time cannot elapse; explicitly label the fork. Do not weaken deployed settlement rules just to shorten a demo.
- [ ] Run the live successful lifecycle and browser journey; complete the shared gate.

### I5. Idempotent seed

**Files:** `scripts/seed.mjs` (new), scripts package commands, tests `scripts/test/seed.test.ts` (new), `plan/08-ship.md`.

- [ ] Write failing tests for restart, duplicate prevention, partial progress and staging-only execution; no credentials in output or checkpoints.
- [ ] Seed a merchant, customers, five invoice states (paid, partial, overdue, sold, refunded), one subscription, agent and allowlisted investor using real service calls. Keep the test-attester bypass explicit if used.
- [ ] Run twice on staging; assert the second run creates no entities or chain writes; complete the shared gate.

### I6. Clean clone

- [ ] Clone locally to a fresh scratch directory; follow only `README.md`, without copying `.env` or private handoff files. Record missing prerequisites clearly.
- [ ] Repair setup/documentation failures, rerun the affected steps, and update `plan/08-ship.md`; no push, account creation or production use.

### I7. Demo rehearsal

- [ ] Rehearse the staging journey with a stopwatch; cover merchant, customer, investor and agent in 2–4 minutes. Record actual duration and missing shots in `DEMO.md`.
- [ ] Save secret-free evidence and leave final video recording to the owner; complete the shared gate for any product repairs.

### I8. Security pass

**Files:** `contracts/`, `plan/review-opus-1.md`, security evidence; read relevant installed audit instructions before use.

- [ ] Locate and run `solidity-auditor` and `x-ray`; obtain Trail of Bits instructions through the permitted installation path. Report unavailable tools accurately.
- [ ] Run Slither directly and on a scratch copy with storage reentrancy guard when transient parsing prevents analysis. Record exact tool/source versions.
- [ ] Validate each finding; write a failing regression test before each fix. No contract changes before a written coordinated redeployment plan.
- [ ] Run unit/fuzz/invariant/fork tests and money-path coverage; rerun affected scans, update the review and complete the shared gate.

### I9. Complete gas-tank accounting

**Files:** `services/api/src/relayer/tankSend.ts`, affected auth/invoice/refund routes, relayer tests.

- [ ] Write failing tests for activation, invoice creation and refund charges: simulate before reserving, atomic concurrent budgets, receipt-based actual cost, failures/retries/replays and conservation.
- [ ] Route costs through the existing sender/accounting model; define activation funding before a merchant tank exists. Preserve abuse caps.
- [ ] Verify real staging receipts against tank debits and refusal at exhausted limits; complete the shared gate.

### I10. Phase 9 depth

- [ ] Before each new subsystem, write `plan/research-<topic>.md` with current primary sources: business reconciliation/tax/FX needs; Request, Bitwave, Centrifuge, Credix, Huma, Stripe, Coinbase and x402; financing/compliance requirements; deployed ENS behavior.
- [ ] Recovery: write failing account authorization tests before adding a second passkey; document coordinated contract deployment first. Prove new-key login and old-key/unauthorized rejection on staging.
- [ ] Import: test CSV validation, duplicates, formula injection and partial rollback; imported historical records never fabricate onchain payments or reputation.
- [ ] Implement deeper books and agent interfaces in D/F below, then treasury and financing depth. Do not reorder earlier gaps to start speculative modules.

### I11. Multisig

- [ ] Request the intended Safe address and verify its chain/ownership before preparing exact owner/guardian transfers. No guessed address or transaction execution.
- [ ] Add access-boundary tests and a recovery/acceptance checklist; execute only with explicit approval and verify resulting roles.

### I12. Deferred hostname migration

- [ ] After the earlier work, migrate one staging hostname at a time; verify every Worker `name` before and after, routing and regression flow. The owner must update the World callback portal before it changes.

### I13. Publishing gate

- [ ] Keep packages publish-ready and tarball-install-tested. Resolve the unavailable `@stenmont` namespace and `stenmontglobal` naming with the owner before package/import changes.
- [ ] Publish or push only after an explicit yes; never put credentials in tracked files or output.

## Part II: A through G, after the Part I gaps

Each section is a set of staging slices, using the same test-first and completion gate. Create detailed function signatures and migrations when its slice starts, based on then-current source.

### A. Business onboarding and settings

**Files:** `apps/web/app/page.tsx`, signup/onboarding/dashboard settings pages, new onboarding routes/state and next numbered migrations; existing brand tokens and licensed Adobe font project.

- [ ] Write `onboarding.test.ts` and `onboarding.spec.ts`: saved progress across login/reload, failed activation retry, optional World cancellation, API key shown once, no cross-business state access.
- [ ] Deliver business landing page and resumable wizard: passkey, name/country, activation, key, optional World, ENS, accounting format, limited member and first invoice. Empty states explain the next action.
- [ ] Extend settings for team roles, API key revoke, webhook delivery log/retry, gas usage/top-up instructions, payout lock and agents. Test tenant boundaries, signature validation and retry deduplication in `settings.test.ts`/`settings.spec.ts`.
- [ ] Verify each slice on staging and mobile/keyboard layouts; complete the shared gate.

### B. Hosted storefront and checkout

**Files:** new catalogue/order routes and D1 tables, dashboard product/order pages, hosted store/cart/confirmation pages; retain `apps/example-store` integration proof.

- [ ] Write `catalogue.test.ts`, `orders.test.ts`, `storefront.spec.ts`: money validation, stock races, idempotent checkout, order paid only from verified indexed/signed events, fulfilment note, partial-refund cap and return URL safety.
- [ ] Build product name/description/image/price/stock, stable store URL, merchant identity, cart, checkout, receipt, order list and refund action in small slices. Validate image and outbound URL handling.
- [ ] Complete invoice due dates/items/reminders, payment links and subscription create/cancel/status UI; pause must state whether it only pauses collection or is enforced onchain. Test renewal failures and cancellation races.
- [ ] Verify React/button embedding and separate shop → signed webhook → paid order on staging, then the shared gate.

### C. Customer journey completion

- [ ] Extend I2 tests for itemized lines, amount/due date, business/ENS name and safe success/cancel return paths; enforce zero crypto jargon on the primary payment interaction.
- [ ] Prove customer receipt/refund/subscription history matches merchant records after refresh and failed network requests. Download receipt and cancel from a phone-width view on staging.

### D. Back office

**Files:** new ledger/reconciliation/compliance/monitoring routes and dashboard pages, export routes, incremental D1 migrations; existing indexer and audit modules.

- [ ] Write `reconciliation.test.ts`: duplicate/reordered chain events, block time versus ingestion time, payment/refund/fee conservation and unmatched-record handling. Implement a reconciling ledger and visible exceptions.
- [ ] Write `accounting.test.ts`: generic, QuickBooks and real Xero layouts; escaping/formula safety; tax totals and partial allocations; sourced FX rate/time recorded without fabricated fallback; signed close immutable across boundary events. Add JSON export if feasible without delaying required formats.
- [ ] Implement tax lines, FX display, reconciliation, aging, exports and locked signed periods in separate slices. Source target import schemas and disclose confirmation/finality status accurately.
- [ ] Write `compliance.test.ts`: tenant-specific refund thresholds, eligibility and allow/block lists, append-only audit with actor and export; thresholds must match contract enforcement and need a redeploy plan if contract changes are necessary.
- [ ] Write `monitoring.test.ts`: deterministic small-payment/refund-spike/many-merchant rules, boundary tests, deduplicated alerts/webhooks and no secret/customer-data leakage across tenants. Label these basic heuristics, never sanctions screening.
- [ ] Build provider-sourced on/off ramp guidance and a webhook-to-accounting integration recipe. Test signatures against an isolated receiver; label the real accounting-service push “not run” if credentials are unavailable.
- [ ] Add `back-office.spec.ts` covering reconciliation → export → close → alert/audit inspection on staging; complete the shared gate per slice.

### E. ENS and World acceptance

- [ ] Extend I1 for selectable record-limited team roles only where the deployed permission model supports them; test unauthorized record edits, expiry and revocation against Sepolia.
- [ ] Exercise IDKit success, duplicate/ineligible/cancelled paths and server-only validation; exercise buyer/supplier same-human refusal and distinct-human success.
- [ ] Prepare exact Agent Pass links for large refund and agent-limit actions; have the owner complete the human step. Verify callback → validated approval → exactly one protected action and denied/expired → no transaction. Keep unresolved human gates unchecked.

### F. Financing and agents

- [ ] Extend I4 to visible investor onboarding/portfolio/settlement/default records, payer acknowledgement and financing depth selected from the research. Any new money path requires contract properties and coordinated staging deployment.
- [ ] Write `agent-policy.test.ts` and Solidity SpendPolicy tests before promising enforced ENS-associated budgets: per-payment/day limits, scopes, expiry, revocation and action-bound human override; metadata alone never counts as enforcement.
- [ ] Verify named agent → x402 endpoint → real USDT receipt; over-limit request refused with no transfer. Verify authenticated MCP invoice reads and refund draft leaves balances unchanged.
- [ ] For Code Mode, first write `agent-execution.test.ts`: typed `search()`/`execute()` authorization, timeout/resource caps, network restrictions and no secret access. Add a sandboxed interface; no unrestricted server eval. Keep money movement subject to the same policies and human approvals.
- [ ] Re-run gas drain regression and documented live bounded run; complete the shared gate.

### G. Developer experience and application evidence

**Files:** new `apps/web/app/docs/` pages, route-derived API reference generator, package READMEs, `docs/BUILDERS_PROGRAM.md`, setup and seed scripts.

- [ ] Write `api-reference.test.ts`: generated documentation matches registered real routes, auth, errors and request types. Document test mode, keys, webhook signature verification, SDK/React, x402 and MCP with executable examples.
- [ ] Add one-command local setup with safe defaults; run I5 seed twice and I6 clean clone using only public docs. Tarball-install-test SDK/React without publishing.
- [ ] Write the Builders Program brief: problem, real staging demo links, measured metrics with dates, distribution assumptions, team details confirmed by the owner and milestone acceptance evidence. Do not invent traction or guaranteed program benefits.
- [ ] Rehearse the final 2–4 minute demo and Aside tour across every party. Report checked work, failures, “not run” items and owner-dependent gates; stop at staging.

## Verification commands and evidence

- Targeted TypeScript tests: `pnpm --filter @stenmont/api test -- test/ens.test.ts` and `pnpm --filter @stenmont/web test -- test/identity.test.ts` for I1; use equivalent named tests for later slices.
- Full checks: `pnpm test`, `pnpm lint`, `pnpm --filter @stenmont/web typecheck`; build changed web Workers with their staging build commands.
- Contract changes: `cd contracts && forge test`, pinned real-USDT fork profile, coverage and Slither; regenerate with `node contracts/script/export-shared.mjs` after deployment/artifact changes and check drift.
- Deploy only changed Workers with `pnpm deploy:staging`; schema migrations precede dependent API code. Confirm Worker names and addresses before deployment.
- Live browser specs: `cd apps/web && pnpm e2e e2e/identity.spec.ts` (and the corresponding later spec); run Aside afterward with secret-free screenshots and an evidence list.
- Local UI integration: start the web app on port 3100, then run `IDENTITY_UI_APP_URL=http://127.0.0.1:3100 pnpm --filter @stenmont/web exec playwright test e2e/identity-ui.spec.ts`. This API-double suite is opt-in and does not count as real-service acceptance.
- Append actual local/staging commands and results to progress notes. A planned test, prior-session report, skipped spec or simulated World identity is never described as a new real-human success.

## Part V takeover checkpoints

- [x] Preserve own in-progress work in small commits.
- [x] Replay own missing commits onto integration/clean, preserving dates, and report the clean-line branch.
- [x] Reconcile identity migration numbering and connect verified sign-in facts to the integrated tier store.
- [x] Run the combined full suite, lint and web typecheck.
- [x] Deploy only from the clean-line descendant, API then web then MCP, with the owner informed before each deployment.
- [x] Pass every Part V D smoke probe after each deployment.
- [x] Prove Connect/prompt installation in a real browser and OAuth with the real MCP inspector.
- [x] Real-browser signup, prompt-agent integration, pause enforcement, hosted redirect, existing-wallet relay test payment, indexed paid invoice and signed-webhook Paid order.
- [x] Real Inspector OAuth consent/read, wrong PKCE and redirect refusal, revoke denial.
- [x] Sir added the site DNS TXT record; real browser shows Ready, all four checks Passed. See `docs/INSTALL-ACCEPTANCE.md`.
- [ ] Follow Part V F in order after that acceptance gate.

## Combined branch acceptance — 2026-11-06

- [x] Move to chatgpt-work-3 from integration/next and preserve missing fixes by merge.
- [x] Combined full suite, lint and web typecheck.
- [x] Apply staging migrations 0031/0032, set ACCOUNT_LINK_SECRET and deploy API/web/MCP with smoke checks.
- [x] Browser: catalogue store/cart/checkout, receipts link, verified badge and wallet-option absence.
- [x] Condense builder notes; test abandoned-record cleanup and clean only the two unpaid records, preserving the paid receipt.
- [x] Repeat lifecycle dry-run after these steps; stop before another real run.
- [ ] Sir approves any further real tokenization lifecycle run.

## Wave build extension — 2026-11-06

- [x] Dispatch W1–W6 in isolated clones from 08272b6 and preserve salvaged commits with cherry-pick -x.
- [x] Merge W1–W6 with individual history retained; independently run contract and targeted cross-workstream checks.
- [ ] Close all material integration findings, then run the complete combined suite, lint, web typecheck and build.
- [x] One announced staging release with migrations 0040/0041/0050/0060, API→web→MCP and live probes. Operational follow-up 0070 also deployed; 40/40 probes after each service.
- [ ] W7: dashboard Sell this invoice → claim timeline → public certificate; do not repeat the already-settled direct-contract lifecycle.
- [ ] W6b: replace rejected landing with original reference-led component set; visually inspect1440/390 views and fix.
- [ ] W13: isolated realistic demo shop, Razorpay test mode, real Connect/OAuth onboarding and webhook/order/dashboard proof. Public GitHub creation requires explicit approval; owner will configure Razorpay staging secrets.
- [ ] W14: every-page visual inventory, metadata/social images/canonicals/sitemaps/robots/visible JSON-LD and accessibility. Staging must remain non-indexable; private record routes must not enter public sitemaps.
- [ ] W15: inspect deployed Sepolia capabilities, implement supported name/record permissions, and prove through resolve(); document unsupported features.
- [ ] W16: only after router-v2 approval, auction/acknowledgement/reputation pricing and named certificate; fractional funding is a stretch.
- [ ] SDK/React @stenmontglobal publication waits for explicit owner approval.

### Wave staging verification checkpoint

- [x] Combined workspace 1636 tests, lint, web typecheck and Cloudflare bundle passed at 9cbe94a.
- [x] New demo-shop DNS and signed webhook verified; real Inspector OAuth/read/revocation exercised.
- [ ] Demo-shop paid order, indexed dashboard invoice and Connect4/4; checkout reconciliation remains open.
- [ ] Deliberately interrupted receipt recovery verified live; local regressions alone do not close this gate.

### Commerce positioning and v2 activation

- [x] Founder commerce/finance positioning applied to README, user flows and Builders Program draft; existing original user-flow document preserved privately.
- [x] Router v2 security branch merged without squash; independent482-test contract suite passed.
- [x] Option(a) API/pay flow and version routing verified; receipt-classified legacy provenance, independent browser contract reads and deployment dry-run passed.
- [x] Announced and completed testnet v2 deployment; all six sources verified and roles/wiring/domains read back.
- [x] Live named-buyer discount, payout/wrong-buyer/expiry refusals, acknowledgement quote reduction and receipt-backed creation recovery verified.
- [ ] Complete real World and dashboard investor listing/funding/payment/settlement/certificate; general creation remains held until acceptance.
- [x] World session run sheet source/public-entry links checked and reported ready; actual human session remains not run.
- [x] agent/cards integrated with corrected public-safe claims; owned cards/source folder committed as one task after independent rerender and visual review.
- [x] Staging visual inspection:35 page templates plus retained v1 pay at1440/390;72 captures,26 affected-route rechecks and final Settings retakes. Mobile money/badge/button wraps corrected; functional World/investor acceptance remains separate.

- [x] Combined agent fixes and Shopify bridge source reviewed/merged;1938 tests, lint/typecheck/build and coordinated staging API/web/MCP release passed. Strict creation exceptions retain only the two test merchants.
- [ ] Real World session, first-use investor passkey and sir-supplied test USDT, followed by full v2 dashboard lifecycle; no attester shortcut.

- [x] Sir authorized exact2.00 test-USDT investor setup; successful receipt and balance verified, no WBT transfer. Preserve sir’s Brave profile.
- [ ] Merchant tier3 World prerequisite blocks the normal1.00 invoice listing (actual403); then investor proof/funding and full certificate journey.
- [x] Pay-page null/zero buyer-lock label fixed with rendered regression;389 web tests and typecheck passed.
