# Phase 2: Get paid (Whitechain Operate, the core)

**Goal:** a customer pays an invoice in official USDT and the merchant sees it, with a webhook and an on-chain receipt.
**Tech:** Solidity 0.8.38 + OpenZeppelin 5.6.1 (`EIP712`, `SignatureChecker`, `SafeERC20`), Hono Worker, D1, Queues, Cron Triggers, viem.
**Depends on:** Phase 1, spike 0.1 (USDT function signature), spike 0.3 (verify flags).
**Done when:** a script creates an invoice through the API, pays it with the official USDT, the indexer marks it paid, one webhook arrives, and the explorer shows the transaction and the verified contract.

## Review focus

1. Second payment on a fully paid invoice reverts (`InvoiceNotOpen`). Payment above the remaining amount reverts (`Overpay`).
2. Refund above `paid - refunded` reverts (`RefundTooLarge`); refund on a cancelled invoice is allowed only up to what was paid.
3. Same webhook event delivered twice: the receiver sees the same `id`; our indexer inserting the same `(txHash, logIndex)` twice creates one row.
4. Router USDT balance is exactly 0 after every `pay`, `refund` and with a hostile payer (fuzz).
5. Signature replay: a merchant `CreateInvoice` signature used twice reverts (`InvoiceExists`); expired `deadline` reverts.

### Task 2.1: PaymentRouter, invoice lifecycle

**Files:** Create `contracts/src/PaymentRouter.sol`, `contracts/src/interfaces/{IPaymentRouter,IUSDT,IClaimPayout}.sol` (`IPaymentRouter` declares the `Invoice`, `CreateInvoice` and `Auth` structs), `contracts/test/PaymentRouter.t.sol`, `contracts/test/mocks/MockUSDT.sol` (EIP-3009 mock for unit tests)
**Produces:** see `contracts/src/interfaces/IPaymentRouter.sol` and `contracts/src/PaymentRouter.sol` (source of truth). Built beyond the original sketch: merchant-scoped ids (`ref`), payment nonces derived from the invoice id (a relayer cannot redirect a signed payment), per-payer refund caps, payer lock, minimum partial payment, delegated creation, payout hook, pause, and human approval for large refunds.

- [x] Failing tests: `test_createInvoice_storesInvoiceAndEmits`, `test_createInvoice_twiceReverts_InvoiceExists`, `test_createInvoice_expiredDeadlineReverts_Expired`, `test_createInvoice_wrongSignerReverts_BadSignature`, `test_cancel_setsCancelled`, `test_cancel_paidInvoiceReverts_InvoiceNotOpen`
- [x] Run `cd contracts && forge test --match-contract PaymentRouterTest` → FAIL
- [x] Implement `createInvoice` and `cancel` per the signatures; store `status = Open`
- [x] Run the same command → PASS
- [ ] Commit line: `feat: add PaymentRouter invoice creation and cancel`

### Task 2.2: PaymentRouter, pay and refund

**Files:** Modify `contracts/src/PaymentRouter.sol`, `contracts/test/PaymentRouter.t.sol`; Create `contracts/test/PaymentRouter.invariant.t.sol`
**Consumes:** Task 2.1 types; the exact `receiveWithAuthorization` signature recorded by spike 0.1.
**Produces:**
```solidity
function pay(bytes32 id, uint128 value, Auth calldata a) external;      // anyone (the relayer) may submit
function refund(bytes32 id, uint128 value, address to, Auth calldata merchantAuth) external; // merchantAuth.payer == invoice.merchant
event InvoicePaid(bytes32 indexed id, address indexed payer, uint128 value, uint128 paidTotal, bool fullyPaid);
event InvoiceRefunded(bytes32 indexed id, address indexed to, uint128 value, uint128 refundedTotal);
error Overpay(); error RefundTooLarge();
```
`pay` calls `usdt.receiveWithAuthorization(a.payer, address(this), value, …)`, then sends `value` to `invoice.payout` (or to `invoice.hook` and calls `IClaimPayout(hook).onPaid(id, value)` when `hook != address(0)`). `refund` pulls from the merchant with their authorization and forwards to `to`.

- [x] Failing tests: `test_pay_full_marksPaid_andForwardsToPayout`, `test_pay_partial_thenRest`, `test_pay_overpay_reverts`, `test_pay_afterPaid_reverts_InvoiceNotOpen`, `test_pay_afterCancel_reverts`, `test_refund_partial`, `test_refund_aboveRemaining_reverts_RefundTooLarge`, `test_pay_withHook_callsOnPaid` (hook is a mock)
- [x] Invariant test `invariant_routerHoldsNoUSDT`: handler fuzzes create/pay/refund/cancel; asserts `usdt.balanceOf(router) == 0` after every call
- [x] Run `forge test` → FAIL
- [x] Implement `pay` and `refund`
- [x] Run `forge test` → PASS (unit + 256 invariant runs)
- [ ] Commit line: `feat: add PaymentRouter pay and refund`

### Task 2.3: Deploy and verify on Whitechain Sepolia, first real payment

**Files:** `contracts/script/DeployRouter.s.sol`, `contracts/test/DeployRouter.t.sol`, `contracts/deployments/1874.json` (single source of truth), `contracts/script/export-shared.mjs` (generates `packages/shared/src/addresses.ts` and `abis/`), `scripts/first-payment.ts`
**Result:** staging deployment `PaymentRouter` at `0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929` (block 12,312,560). The production deployment is a separate fresh deploy before submission.

- [x] Deploy script plus a test of its wiring (roles, threshold, default 100 USDT), simulated on the live chain first, then broadcast
- [x] Verified on the explorer with `forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --compiler-version 0.8.38 --num-of-optimizations 200`
- [x] `export-shared.mjs` generates the TypeScript ABI and addresses; CI fails if they drift from the contracts
- [x] First payment: merchant signed the invoice, demo payer signed a USDT authorization, relayer paid the gas. Payer 30.00 to 29.00 USDT with 0 WBT held, merchant 10.00 to 11.00, invoice Paid
- [x] Links saved in `BUILDER-NOTES.md` (they go in the final README)
- [ ] Commit lines added to `commits.md`

### Task 2.4: API keys, invoices, payment links

**Files:** `services/api/src/{app,auth,idempotency,audit,errors,chain,env}.ts`, `src/routes/{invoices,links,public,webhookEndpoints}.ts`, `src/lib/{crypto,validation,views}.ts`, `migrations/0002_api_core.sql`, tests in `services/api/test/`
**Built (differs from the first sketch):**
- Invoices are created onchain through the router's delegation: the merchant signs `setCreator` once (`scripts/delegate-creator.ts`) and the API uses the relayer key. The API never holds a merchant key.
- A `customers` table is not needed yet; the invoice carries `customer_email`. Customers arrive with the dashboard (Phase 4).
- Idempotency stores a pending marker first, so a concurrent duplicate gets 409; an error response releases the key.
- Webhook endpoints reject non-https URLs and loopback or private hosts (no calls into our own network).
- Known limit, fixed in Phase 3: `createInvoice` sends the relayer transaction directly, so two simultaneous creations can collide on the nonce. The Durable Object relayer serialises them.

- [x] Failing tests first, then implementation: auth (missing, malformed, wrong, revoked), invoices (create, validation, idempotency, duplicate number, chain failure, tenant isolation, list filters), public pay data (no internal fields), payment links, webhook endpoints (secret shown once)
- [x] `pnpm --filter @stenmont/api test` green (45 tests at this point)
- [x] Commit lines added to `commits.md`

### Task 2.5: Indexer (Cron) and webhooks (Queue)

**Files:** `services/api/src/{indexer,delivery,webhooks,events}.ts`, `src/lib/signature.ts`, `wrangler.jsonc` (cron, queue producer and consumer, router vars), tests
**Built:**
- Indexer: windows of at most 2,000 blocks, 2 confirmations behind the head, cursor advances only after a window is fully applied; payments unique per (tx, log index); invoice totals only move forward; events for unknown invoices ignored.
- Webhooks: `Stenmont-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, deliveries unique per (endpoint, event), retries with backoff (20s doubling, capped at 1 hour) up to 10 attempts, then `failed`. The payload bytes are fixed when the event is emitted.
- Events: `invoice.created`, `invoice.partially_paid`, `invoice.paid`, `refund.created`, `invoice.cancelled`.
- Note: a new cron trigger took about 8 minutes to start after the first deploy; later deploys do not repeat that.

- [x] Failing tests first (windows, cursor, RPC failure keeps the cursor, replays change nothing, older events never move an invoice backwards, backoff, give up, skip finished deliveries)
- [x] `pnpm --filter @stenmont/api test` green (68 tests)
- [x] Staging end to end, on the real chain: API created invoice, demo payer paid it, the indexer marked it paid, two webhooks (`invoice.created`, `invoice.paid`) delivered with HTTP 200 on the first attempt
- [ ] Production: not deployed (needs a production router first, then migrations, queue, cron)
- [ ] Commit lines added to `commits.md`
