# Phase 4: Plug in and go past the first payment (Operate, rest)

**Goal:** a separate demo store adds Stenmont in about 20 lines; the merchant and the customer each have a screen; refund, renewal, reminder and accounting export all work.
**Tech:** `@stenmont/sdk`, `@stenmont/react`, Next.js 16 dashboard, Cloudflare Email Sending, Cron Triggers.
**Depends on:** Phases 2 and 3.
**Done when:** the example store's integration diff is about 20 lines, a customer buys through it, and from the dashboard the merchant refunds in one tap, sees a subscription renew, receives a reminder email, and downloads a CSV.

## Review focus

1. Merchant creates 100 invoices: no passkey prompt per invoice (delegated creation), but one prompt for every refund.
2. Subscription charge when the payer's balance is too low: no revert loop; status `past_due`, retried at +1, +3, +7 days, then `cancelled`.
3. Magic link used twice or after 15 minutes: rejected.
4. CSV with commas or quotes in a customer name: still valid CSV.
5. Webhook `invoice.paid` for an invoice created via checkout session carries the merchant's `metadata` back unchanged.

### Task 4.1: Delegated invoice creation (router change)

**Files:** Modify `contracts/src/PaymentRouter.sol`, `contracts/test/PaymentRouter.t.sol`; redeploy with `script/DeployRouter.s.sol`
**Produces:** `function setCreator(address creator, bool allowed, uint256 deadline, bytes calldata merchantSig) external;` `function createInvoiceAsCreator(CreateInvoice calldata req) external;` (reverts `NotCreator()` unless `creators[req.merchant][msg.sender]`), event `CreatorSet(address indexed merchant, address indexed creator, bool allowed)`.

> Built in Task 2.1: delegation (`setCreator`, `createInvoiceAsCreator`) is part of `PaymentRouter`. Only the redeploy step remains.

- [x] Failing tests: `test_setCreator_thenCreateInvoiceAsCreator_works`, `test_createAsCreator_withoutDelegation_reverts_NotCreator`, `test_setCreator_revoked_thenCreateReverts`
- [x] Run `forge test` → FAIL; implement; run → PASS (all earlier tests still pass)
- [ ] Redeploy, verify, update `addresses.ts`, point the indexer at the new address
- [ ] Commit line: `feat: let merchants delegate invoice creation`

### Task 4.2: Magic-link login and onboarding

**Files:** Create `services/api/src/{session.ts,email.ts,routes/auth.ts,routes/merchants.ts}`, `services/api/migrations/0004_auth.sql`, `apps/web/app/{login,onboarding}/page.tsx`
**Produces:** tables `login_tokens(token_hash PK, email, expires_at, used_at)`, `sessions(id PK, merchant_id, expires_at)`. `POST /auth/magic-link {email}` (sends mail), `GET /auth/callback?token=` (sets `HttpOnly; Secure; SameSite=Lax` cookie `st_session`), `POST /v1/merchants` (onboarding: name, passkey public key `x`,`y` → creates the merchant's `PasskeyAccount` via the factory, sets it as `payout_address`, calls `setCreator` for the API's creator key, returns the first API key once). `sendEmail(to: string, subject: string, html: string): Promise<void>` uses the Cloudflare Email Sending binding.

- [ ] Failing tests: link works once; second use 400; after 15 minutes 400; sessions expire after 7 days; onboarding returns `sk_test_…` exactly once
- [ ] Run → FAIL; implement; run → PASS
- [ ] Live check: sign up with your Gmail, receive the email from `login@stenmont.com`
- [ ] Commit line: `feat: add magic-link login and merchant onboarding`

### Task 4.3: SubscriptionManager

**Files:** `contracts/src/SubscriptionManager.sol`, `contracts/src/interfaces/ISubscriptionManager.sol`, `contracts/script/DeploySubscriptionManager.s.sol`, tests `SubscriptionManager{,.invariant}.t.sol`, `fork/SubscriptionManager.fork.t.sol`, `DeploySubscriptionManager.t.sol`
**Built (beyond the first sketch):** the customer signs one EIP-712 `Subscribe` message (works for passkey accounts via ERC-1271) and an optional EIP-2612 permit. Every subscription has a hard `maxCharges` (at most 10,000), so the total ever pulled is `amount * maxCharges`. A charge goes straight payer to payout; the manager never holds money. Anyone can trigger a due charge, but only once per period. Missed periods are skipped, never billed together. The payer or merchant can cancel any time, even while paused, and the payer can cancel by signature so a relayer can submit it.
- **Permit design:** a permit SETS the allowance (it does not add), so `subscribe` takes `permitValue` and the signer chooses "current allowance + this cap". A griefer who front-runs the permit cannot block a subscription (the permit is wrapped and the allowance is checked instead).
- **Found by the tests:** a payer exactly one period late could be charged twice in a row (the next charge time equalled now). Fixed with `>=` and regression tests; also found that the contract computing the permit value itself would overwrite allowances for a payer's other subscriptions.
- **slither:** the `arbitrary-send-erc20` finding on `transferFrom(s.payer, …)` is a false positive by design (the payer is written only after their signature is verified) and is annotated with that reasoning.

- [x] 43 tests: unit and access, 1,000-run fuzz over amounts, periods, charge counts and timing (boundary classes: before, exactly at, just after), 3 handler-driven invariants (the manager holds nothing, payouts equal what was charged, charge counts and statuses agree), 3 fork tests on the real USDT (EOA permit, smart-account permit, a payer who runs out of funds)
- [x] Staging deployment verified: `0x3e1C51d461e6adb0b087DC39d41942E084eba2DD`
- [x] ABIs, addresses and typed data (pinned to the deployed typehashes) in `packages/shared`
- [ ] Commit lines added to `commits.md`

### Task 4.4: Refunds, subscriptions, reminders, export (API)

**Files:** Create `services/api/src/routes/{refunds,subscriptions,exports}.ts`, `services/api/src/jobs/{reminders,renewals}.ts`, `services/api/migrations/0005_billing.sql`, tests alongside
**Produces:** `POST /v1/refunds {invoiceId, amount?}` → `{approvalNeeded: true, typedData}` for the merchant passkey to sign, then `POST /v1/refunds/:id/submit {signature}`; `POST /v1/subscriptions`, `POST /v1/subscriptions/:id/cancel`; `GET /v1/exports/payments.csv?from&to&format=generic|quickbooks`. Cron `0 * * * *` runs `renewals` (charge due subs) and `reminders` (email customers 3 days before due, on due date, 3 days after). Tables `subscriptions(id, merchant_id, customer_id, payer, amount TEXT, period_seconds, next_charge_at, status, failed_attempts)`, `refunds(id, invoice_id, to_address, value TEXT, tx_hash, reason)`.

- [ ] Failing tests for each Review-focus item above (past_due schedule, CSV quoting, refund cap through the API, reminder sent once per window)
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add refunds, subscriptions, reminders and CSV export`

### Task 4.5: SDK and React button

**Files:** Create `packages/sdk/src/{index,client,webhooks}.ts`, `packages/react/src/{PayButton,index}.tsx`, tests
**Produces:**
```ts
class Stenmont { constructor(opts: {apiKey: string; baseUrl?: string});
  invoices: { create(i: {amount: string; customerEmail?: string; dueDate?: string; metadata?: Record<string,string>}): Promise<{id: string; payUrl: string}>; get(id: string): Promise<Invoice> };
  checkout: { sessions: { create(s: {amount: string; successUrl: string; cancelUrl: string; metadata?: Record<string,string>}): Promise<{id: string; url: string}> } };
  refunds: { create(r: {invoiceId: string; amount?: string}): Promise<{approvalNeeded: true; approvalUrl: string}> };
}
function verifyWebhook(body: string, header: string, secret: string, toleranceSeconds?: number): WebhookEvent // throws on bad signature or old timestamp
function PayButton(props: {sessionUrl: string; children?: ReactNode}): JSX.Element
```

- [ ] Failing tests against a mock server: create invoice maps fields; `verifyWebhook` rejects a tampered body, rejects a timestamp older than 5 minutes, accepts a valid one
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add Stenmont SDK and React pay button`

### Task 4.6: Example store (the 20-line integration)

**Files:** Create `apps/example-store/` (separate app, its own `package.json`, deployed at `shop.stenmont.com`), `apps/example-store/INTEGRATION.md` (the ≤20-line diff shown to judges)

- [ ] The store starts with a plain cart and a fake "Pay" button; commit that as the baseline in `commits.md`
- [ ] Add Stenmont: install the SDK, a server route creating the checkout session, `<PayButton/>`, and a webhook route that marks the order paid. Count with `git diff --stat` on the baseline: ≤ 20 added lines of integration code
- [ ] Playwright: buy a product, pay, land on success, order status `paid` via webhook
- [ ] Commit line: `feat: add example store using Stenmont`

### Task 4.7: Dashboard screens

**Files:** Create `apps/web/app/dashboard/{invoices,payments,subscriptions,customers,settings}/page.tsx`, `apps/web/components/RefundButton.tsx`

- [ ] Failing Playwright tests: invoice list shows new invoice; Refund button runs the passkey prompt then status shows `refunded`; settings page shows API key prefix, webhook endpoints, gas tank balance; Export button downloads a CSV
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add merchant dashboard`
