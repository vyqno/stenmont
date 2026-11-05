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

**Files:** Create `contracts/script/DeployRouter.s.sol`, `scripts/first-payment.mjs`, `contracts/deployments/1874.json`
**Produces:** deployed address in `deployments/1874.json` and `packages/shared/src/addresses.ts` (`PAYMENT_ROUTER: Address`).

- [ ] Run `forge script script/DeployRouter.s.sol --rpc-url https://rpc.testnet.whitechain.io --broadcast` with `STENMONT_DEPLOYER_PRIVATE_KEY`; copy the address into `addresses.ts`
- [ ] Verify with the flags that worked in spike 0.3; open the explorer page and see "verified"
- [ ] `first-payment.mjs`: merchant (`DEPLOYER`) signs `CreateInvoice` for 1.00 USDT; `DEMO_PAYER` signs `receiveWithAuthorization`; `RELAYER` submits `createInvoice` then `pay`. Prints the explorer URL
- [ ] Open the URL: status success, `InvoicePaid` event present, USDT `Transfer` of 1,000,000 units to the merchant payout. Save the link in `BUILDER-NOTES.md` (it goes in the final README)
- [ ] Commit line: `feat: deploy PaymentRouter to Whitechain Sepolia`

### Task 2.4: API keys, invoices, payment links

**Files:** Create `services/api/src/{auth.ts,idempotency.ts,audit.ts,routes/invoices.ts,routes/links.ts}`, `services/api/migrations/0001_invoices.sql`, `services/api/test/{auth,invoices}.test.ts`
**Produces:** D1 tables `customers(id, merchant_id, name, email)`, `invoices(id TEXT PK /*bytes32 hex*/, merchant_id, customer_id, number, status, amount TEXT, amount_paid TEXT, amount_refunded TEXT, due_date, meta_hash, created_at)`, `payments(id, invoice_id, payer, value TEXT, tx_hash, log_index, block, created_at, UNIQUE(tx_hash, log_index))`, `payment_links(id, merchant_id, slug, amount, reusable, active)`. Routes: `POST /v1/invoices` (body `{amount: string, customerEmail?, dueDate?, number?}` → `{id, payUrl, status}`), `GET /v1/invoices`, `GET /v1/invoices/:id`, `POST /v1/payment-links`, `GET /pay/:id` (public data for the pay page). Auth: `Authorization: Bearer sk_test_<32 hex>`; store `sha256` + 8-char prefix. Money-moving POSTs require `Idempotency-Key`.
**Single scoping helper:** `scoped(db, merchantId)` is the only way routes query tenant tables.

- [ ] Failing tests: `unauthorized → 401`; `valid key creates invoice → 201 with payUrl`; `same Idempotency-Key twice → identical response, one row`; `merchant A cannot read merchant B's invoice → 404`; `every create writes one audit_log row`
- [ ] Run `pnpm --filter @stenmont/api test` → FAIL
- [ ] Implement auth middleware, `scoped()`, idempotency, audit, routes. Invoice creation builds the `CreateInvoice` typed data for the merchant to sign (merchant signing arrives with the passkey account in Phase 3; in this phase the API holds a test merchant key `STENMONT_DEPLOYER_PRIVATE_KEY` (the test merchant) for the demo)
- [ ] Run tests → PASS
- [ ] Commit line: `feat: add API auth, invoices and payment links`

### Task 2.5: Indexer (Cron) and webhooks (Queue)

**Files:** Create `services/api/src/{indexer.ts,webhooks.ts,queue.ts}`, `services/api/migrations/0002_events.sql`, `services/api/test/{indexer,webhooks}.test.ts`
**Produces:** table `chain_cursor(name PK, last_block)`, `webhook_endpoints(id, merchant_id, url, secret, events)`, `webhook_deliveries(id, endpoint_id, event_id, type, payload, status, attempts, next_attempt_at)`. `scheduled()` every minute; queue `stenmont-webhooks`. Webhook body `{id, type, created, data, livemode:false}`; header `Stenmont-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "${t}.${body}">`. Event types: `invoice.created`, `invoice.partially_paid`, `invoice.paid`, `refund.created`, `invoice.cancelled`.

- [ ] Failing tests with a fake chain client: `getLogs window of 2000 blocks max`; `same log processed twice → one payments row`; `InvoicePaid(fullyPaid=true) → invoice.status paid + one invoice.paid delivery`; `failed delivery retries with backoff, gives up after 8 attempts → status failed`; `signature header verifies with the endpoint secret`
- [ ] Run tests → FAIL
- [ ] Implement `indexer.ts` (reads `chain_cursor`, `getLogs` for the router in ≤2000-block windows, decodes with the router ABI, upserts, enqueues) and the queue consumer (POST with signature; `message.retry({delaySeconds: 2**attempts * 10})`)
- [ ] Run tests → PASS
- [ ] Create the queue: `npx wrangler queues create stenmont-webhooks`; add producer/consumer bindings; `npx wrangler deploy`
- [ ] End to end: run `scripts/first-payment.mjs` against the live API; within 1 minute the invoice shows `paid` and a test endpoint (webhook.site URL) receives exactly one `invoice.paid`
- [ ] Commit line: `feat: add chain indexer and signed webhooks`
