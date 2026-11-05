# Phase 7: Get paid early (Whitechain Tokenize)

**Goal:** a business sells an invoice to an allowlisted investor for cash today; the payer's payment settles the investor automatically; a missed due date triggers default and the reserve pays the investor.
**Tech:** Solidity, OpenZeppelin EIP-712, D1, the investor page in Next.js.
**Depends on:** Phases 2, 3, 5 (World gate for investors).
**Done when:** issue, fund and settle run end to end on-chain, and a non-allowlisted buyer's attempt reverts, all shown in the demo with explorer links.

## Review focus

1. Payer pays the merchant directly after the invoice was sold: the money still goes to the claim (hook), not the merchant.
2. Investor not on the allowlist (or revoked after funding) tries to fund or transfer: reverts.
3. Funding the same claim twice: second reverts. Claim listed on a partly paid invoice: reverts.
4. `onPaid` called by anyone other than the router: reverts.
5. Default before `dueDate + 7 days`: reverts. Default after: reserve goes to the investor once, never twice.

### Task 7.1: Router hook setter

**Files:** Modify `contracts/src/PaymentRouter.sol`, tests; redeploy
**Produces:** `function setHook(bytes32 id, address hook, uint256 deadline, bytes calldata merchantSig) external;` allowed only while `status == Open && paid == 0 && hook == address(0)`; event `HookSet(bytes32 indexed id, address hook)`; errors `HookLocked()`.

- [ ] Failing tests: `test_setHook_beforePayment_ok`, `test_setHook_afterPartialPayment_reverts_HookLocked`, `test_setHook_twice_reverts_HookLocked`, `test_setHook_badSig_reverts_BadSignature`
- [ ] Run `forge test` → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add invoice payout hook`

### Task 7.2: InvestorRegistry

**Files:** Create `contracts/src/InvestorRegistry.sol`, `contracts/test/InvestorRegistry.t.sol`
**Produces:** `function allow(address investor, uint256 deadline, bytes calldata attesterSig) external;` (EIP-712 `AllowInvestor`, signed by the `ATTESTER` key after the server verified the World `allow-investor` proof), `function revoke(address investor) external onlyOwner;`, `function isAllowed(address investor) external view returns (bool);`, events `InvestorAllowed`, `InvestorRevoked`.

- [ ] Failing tests: valid attestation allows; wrong signer reverts; expired deadline reverts; revoke makes `isAllowed` false; replay after revoke with the old signature reverts (nonce per investor)
- [ ] Run → FAIL; implement; run → PASS; deploy + verify; add `INVESTOR_REGISTRY` to `addresses.ts`
- [ ] Commit line: `feat: add investor allowlist registry`

### Task 7.3: InvoiceClaim, sell an invoice

**Files:** Create `contracts/src/InvoiceClaim.sol`, `contracts/test/InvoiceClaim.t.sol`, `contracts/test/InvoiceClaim.invariant.t.sol`
**Produces:**
```solidity
enum ClaimStatus { None, Listed, Funded, Settled, Defaulted }
struct Claim { address merchant; address investor; uint128 face; uint128 price; uint128 reserve; uint128 received; uint64 dueDate; ClaimStatus status; }
function list(bytes32 invoiceId, uint16 discountBps, uint16 reserveBps, uint256 deadline, bytes calldata merchantSig) external; // face == invoice.amount; calls router.setHook(...)
function fund(bytes32 invoiceId, IPaymentRouter.Auth calldata investorAuth) external;   // investor must be allowed; pays price; merchant gets price - reserve
function onPaid(bytes32 invoiceId, uint128 value) external;                              // only router; forwards value to investor; at received == face release reserve to merchant, Settled
function markDefault(bytes32 invoiceId) external;                                       // after dueDate + 7 days if not Settled; reserve to investor; Defaulted
function transferClaim(bytes32 invoiceId, address to) external;                          // only investor; `to` must be allowed
```
`price = face * (10000 - discountBps) / 10000`, `reserve = face * reserveBps / 10000`.

- [ ] Failing tests: `test_list_setsHook`, `test_fund_paysMerchantPriceMinusReserve`, `test_fund_notAllowlisted_reverts`, `test_fund_twice_reverts`, `test_payerPays_routesToInvestor_andReleasesReserve`, `test_onPaid_notRouter_reverts`, `test_markDefault_beforeGrace_reverts`, `test_markDefault_afterGrace_reserveToInvestor`, `test_transferClaim_toNonAllowlisted_reverts`
- [ ] Invariant: for every claim, USDT held by the contract equals the sum of `reserve` of Funded claims
- [ ] Run → FAIL; implement; run → PASS; deploy + verify; add `INVOICE_CLAIM` to `addresses.ts`
- [ ] Commit line: `feat: add InvoiceClaim for selling invoices`

### Task 7.4: Reputation from payments, financing API

**Files:** Create `services/api/src/{reputation.ts,routes/financing.ts}`, `services/api/migrations/0009_financing.sql`, tests
**Produces:** table `reputation(subject PK /*address or ENS*/, invoices_paid, on_time, late, avg_days_early REAL, volume TEXT, score INTEGER, updated_at)` updated by the indexer on every `InvoicePaid`; `score = clamp(round(100 * on_time / max(invoices_paid,1)))`. Routes `POST /v1/financing/claims {invoiceId, discountBps, reserveBps}` (returns typed data to sign), `GET /v1/financing/market` (open claims with the payer's reputation), `POST /v1/financing/claims/:id/fund`, indexer handlers for `ClaimListed|Funded|Settled|Defaulted` and webhooks `financing.*`.

- [ ] Failing tests: on-time payment raises `on_time`; late lowers score; market lists only `Listed` claims; funded claim disappears from the market
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add reputation and financing API`

### Task 7.5: Investor page and merchant "sell this invoice"

**Files:** Create `apps/web/app/invest/page.tsx`, `apps/web/app/dashboard/invoices/SellButton.tsx`, e2e tests

- [ ] Failing Playwright tests: investor completes the World step (mock) and is allowed; market shows a claim with discount, payer score and due date; Fund runs a passkey tap and shows "Funded"; merchant sees cash received; payer pays at due date and the portfolio shows "Settled"
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add investor page and sell-invoice flow`

**Stretch (only if time remains):** order financing in stages (trade finance) and supplier programme. Write their own plan files first.
