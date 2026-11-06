# Router v2 security review

Internal review of the router v2 contract set before a test-network redeploy. This is not an external audit. Nothing here was deployed, broadcast or verified on an explorer.

## Scope

| Contract | File | Status |
|---|---|---|
| PaymentRouterV2 | `contracts/src/PaymentRouterV2.sol` (+ `interfaces/IPaymentRouterV2.sol`) | reviewed, 4 fixes |
| InvoiceClaimV2 | `contracts/src/InvoiceClaimV2.sol` | reviewed, 1 fix |
| InvoiceAck | `contracts/src/InvoiceAck.sol` | reviewed, no change |
| ReputationRegistryV2 | `contracts/src/ReputationRegistryV2.sol` | reviewed, no change |
| SubscriptionManager | `contracts/src/SubscriptionManager.sol` | reviewed (redeployed alongside v2), no change |
| LedgerAnchor, InvestorRegistry | | coverage only |

v1 contracts (`PaymentRouter`, `InvoiceClaim`, `ReputationRegistry`) are deployed and immutable. They were not changed; findings that also apply to them are listed under residual risks.

## Method

1. Full Foundry suite (unit, fuzz at 1,000 runs, handler-driven invariants with `fail_on_revert`), then the fork profile against the official Whitechain Sepolia USDT at block 12,308,524 (read-only RPC, no transaction sent).
2. Coverage with `forge coverage --ir-minimum` (the default build hits stack-too-deep).
3. Line-by-line review for reentrancy, signature replay (cross-invoice, cross-contract, cross-version, cross-chain), EIP-712 domains, ERC-1271, nonces and expiry, rounding, access control, pause semantics, redeploy wiring, indexer events, gas griefing, front-running, and how early-payment discounts, sold invoices, refunds and the payout hook interact. The specialty checklists of the installed `solidity-auditor` skill (boundary, asymmetry, trust gap, flow gap, economic) were applied in one pass by the reviewer.
4. Failure-mode tests with hostile mock contracts: downstream reverts, gas exhaustion, malformed return data, return-data bombs and re-entry (`test/v2/FailureModesV2.t.sol`).
5. Slither 0.11.6 (102 detectors) on the source as it is, and on a throwaway copy with `ReentrancyGuard` in place of `ReentrancyGuardTransient`, because slither cannot parse the transient guard.
6. Every fix was test-first: the new test failed on the old code, then passed after the fix.

## Results

### Tests (after the fixes)

| Run | Result |
|---|---|
| `forge test` | 482 passed, 0 failed, 32 suites (was 450 in 27 suites) |
| of which fuzz | 27 tests, 1,000 runs each |
| of which invariant | 4 handler suites (router v1, claim v1, claim v2 on router v2, subscriptions), each 256 runs x 25,600 calls, 0 reverts |
| `FOUNDRY_PROFILE=fork forge test` | 27 passed, 0 failed, 4 suites (router v2 fork: 10) |
| `forge fmt --check` | clean |

### Coverage

Command: `forge coverage --ir-minimum --skip "src/PasskeyAccount*.sol" --skip test/P256.t.sol --skip test/PasskeyAccount.t.sol --skip test/DeployFactory.t.sol --skip script/DeployFactory.s.sol --no-match-path "test/{fork/*,P256.t.sol,PasskeyAccount.t.sol,DeployFactory.t.sol}"` (457 tests). The passkey suites are skipped because OpenZeppelin's P256 library does not compile under `--ir-minimum`; they do not touch these contracts.

| Contract | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| PaymentRouterV2 | 98.21% (165/168) | 98.02% (248/253) | 98.15% (53/54) | 100% (27/27) |
| InvoiceClaimV2 | 97.78% (132/135) | 98.35% (179/182) | 100% (39/39) | 100% (17/17) |
| InvoiceAck | 100% (20/20) | 100% (28/28) | 100% (5/5) | 100% (4/4) |
| ReputationRegistryV2 | 100% (26/26) | 100% (31/31) | 100% (9/9) | 100% (6/6) |
| SubscriptionManager | 97.44% (76/78) | 98.21% (110/112) | 100% (24/24) | 100% (12/12) |
| LedgerAnchor | 100% (13/13) | 100% (20/20) | 100% (4/4) | 100% (3/3) |
| InvestorRegistry | 100% (28/28) | 100% (32/32) | 100% (6/6) | 100% (7/7) |
| PaymentRouter (v1) | 98.60% (141/143) | 98.49% (196/199) | 100% (45/45) | 100% (26/26) |
| InvoiceClaim (v1) | 97.66% (125/128) | 97.71% (171/175) | 97.37% (37/38) | 100% (16/16) |

Before this review, InvoiceClaimV2 branches were 97.37% (37/38); the missing branch (`fund` when the router says the invoice is no longer open) is now covered by `test_claim_fund_routerSaysNotOpen_reverts`.

Every line or branch still reported as uncovered is executed by a named test. They are calls into OpenZeppelin internal functions or an inline-assembly statement, which `--ir-minimum` maps inaccurately (Foundry warns about this):

| Reported gap | Executed and asserted by |
|---|---|
| RouterV2 `_pause()`, `_unpause()` (pause/unpause bodies) | `test_pause_guardianOrOwner_only_unpauseOwnerOnly`, `test_routerPause_blocksEveryWrite_guardianCannotUnpause` (assert `paused()` and `EnforcedPause`) |
| RouterV2 `if (allowed) _requireNotPaused()` in `setCreator` | `test_revokeWorksWhilePaused`, `test_grantStillBlockedWhilePaused` (both sides) |
| RouterV2 assembly `call` in `_recordReputation` | `test_gasStarvation_cannotSkipTheRecord`, `test_reputation_realRegistry_recordsOncePerFullPayment` (assert the record exists) |
| ClaimV2 `_pause()`, `_unpause()`, `_requireNotPaused()` in `_update` | `test_pause_guardianOwner_ok_othersRevert`, `test_transfer_paused_reverts` |
| SubscriptionManager `_pause()`, `_unpause()` | existing pause tests in `SubscriptionManager.t.sol` |
| v1 InvoiceClaim branch in `fund` (router not Open) | not covered. It cannot be reached with the real router, and v1 is deployed, so no test was added to it. |

All money paths (create, pay, discount, refund, refund with approval, list, fund, onPaid, default, withdraw) have 100% branch coverage.

### Slither

| Mode | Results | High | Medium | Notes |
|---|---|---|---|---|
| source as is (transient guard) | 47 | 0 | 6 | 29 timestamp, 6 reentrancy-events, 2 reentrancy-benign, 2 missing-zero-check, 1 assembly, 1 missing-inheritance |
| storage-guard copy | 48 | 0 | 6 | the same, plus `return-bomb` on **v1** `PaymentRouter` only |

- Medium `reentrancy-no-eth` (6): `InvoiceClaim{,V2}.onPaid` and `markDefault` write `pending`/`totalPending` after the token call in `_send`. The only callee is the immutable official USDT, which has no transfer callbacks. That write is the fallback that has to follow a refused transfer. `onPaid` only runs for the router, which holds its own guard for the whole payment, and `markDefault` has `nonReentrant`. The re-entry tests in `FailureModesV2.t.sol` (hook into pay or refund, registry into refund) and the claim invariant both hold. Accepted.
- The v2 `return-bomb` warning that Wave 1 left open is gone (finding I-1). The new `assembly` note is that fix.
- `missing-zero-check` on `setReputation`: zero turns recording off on purpose.
- Timestamp notes are the intended deadline, due, discount and grace boundaries. The exact-second boundaries are tested.

## Findings

| ID | Severity | Contract | Title | Status | Commit |
|---|---|---|---|---|---|
| M-1 | Medium | PaymentRouterV2 | Copied SetHook signature bricks an invoice | Fixed | `6f61a55` |
| M-2 | Medium | PaymentRouterV2 | A signed discounted payment can be forfeited or turned into a partial payment | Mitigated off-chain; owner decision | tests in `492006a` |
| M-3 | Medium | InvoiceClaimV2 | Deferred payouts stuck for passkey accounts | Fixed | `87a9d3c` |
| L-1 | Low | PaymentRouterV2 | Submitter can starve the reputation call | Fixed | `e0389b3` |
| L-2 | Low | PaymentRouterV2 | Leaked creator key cannot be revoked during a pause | Fixed | `3bb3ec8` |
| I-1 | Info | PaymentRouterV2 | Reputation return data copied (return bomb) | Fixed | `e0389b3` |
| I-2 | Info | PaymentRouterV2 / ClaimV2 | Payout binding does not cover the hook path | Acknowledged | |
| I-3 | Info | ClaimV2 | Invoice cannot be cancelled once a payment cancels its listing | Acknowledged | |
| I-4 | Info | ClaimV2 | `onPaid` Settled branch unreachable via the router | Acknowledged | |
| I-5 | Info | InvoiceAck | Sequential buyer nonce, no invalidation; payout not signed | Acknowledged | |
| I-6 | Info | PaymentRouterV2 | Indexer must read storage for some fields | Acknowledged | |
| I-7 | Info | all | Hostile ERC-1271 signer can burn the submitter's gas | Acknowledged | |
| I-8 | Info | all | Owner/guardian are EOAs; `renounceOwnership` exists | Acknowledged | |
| I-9 | Info | v1 vs v2 | Shared nonce formulas across versions | Acknowledged | |

### M-1 Copied SetHook signature bricks an invoice (fixed)

`InvoiceClaimV2.list` is a public transaction that carries the merchant's `SetHook(id, claim, deadline)` signature. Before the fix, anyone could copy that signature from the mempool and call `router.setHook` directly first. The router would attach the claim contract to an invoice the claim never listed. After that, every `pay` reverted in `onPaid` (`NotListed`), `cancel` was allowed only to the hook, and `cancelListing` needs a Listed claim. The invoice could be neither paid nor cancelled, and the merchant had to issue a new one. No funds were lost, and the payer's money unwound with the revert. The existing test `test_onPaid_unknownClaim_reverts_soTheRouterRevertsToo` reproduced this state but treated it as acceptable.

Fix: `setHook` now requires `msg.sender == hook` (new error `NotHook`), so a hook attaches only with its own consent, and the claim does that only inside `list` after recording the listing. Tests: `HookFrontRunV2.t.sol`. The existing tests that attach mock hooks now call as the hook.

### M-2 A signed discounted payment can be forfeited or turned into a partial payment (owner decision)

The payer's token authorization commits to (invoice, payout, salt, value). It does not commit to "this payment settles the invoice". Two ways the discount can be lost:

1. **Dust front-run.** On an invoice with no `payerLock`, anyone (including the merchant) can make a tiny first payment just before the buyer's discounted payment lands, if it is at least `minPayment`. The discount needs `paid == 0`, so it is forfeited for good. The buyer's signed 98 then lands as a partial payment and the buyer still owes about 2. Proven by `test_discount_unlockedInvoice_dustFrontRunForfeitsDiscount`. Cost to the attacker: dust plus gas. The buyer ends up paying face value, so nothing beyond face is taken, but a stated term ("one payment of the discounted amount inside the window settles the invoice") is broken. The merchant gains from breaking its own offer.
2. **Late inclusion.** If the payment is mined after `discountUntil`, the same amount lands as a partial payment (`test_discount_lateSubmission_withLooseAuth_becomesPartial`).

Mitigations available with no contract change, both proven by tests:
- Set `payerLock` to the buyer on discount invoices, so only the buyer can pay (`test_discount_lockedInvoice_dustFrontRunRefused_buyerSettlesAtDiscount`).
- Sign discounted payments with `validBefore = discountUntil + 1`, so the token refuses a late submission instead of booking it as partial (`test_discount_lateSubmission_withBoundedAuth_isRefusedNotConverted`).

There was no contract change, because each on-chain fix changes the product's rules:
- (a) refuse discount terms without a `payerLock`;
- (b) while the offer window is open, refuse a first payment below the discounted amount;
- (c) add a separate "pay in full" entry point with its own nonce domain that reverts unless the invoice closes. This stops the conversion, but not the forfeiture.

Recommendation: the v2 API must set `payerLock` on every discount invoice and bound `validBefore`. Hitesh to decide whether (a) should also be enforced on-chain.

### M-3 Deferred payouts stuck for passkey accounts (fixed)

When the token refuses a claim payout (recipient blocklisted, token paused during `markDefault`), the amount is credited to `pending[recipient]`. Before the fix, only `withdrawPending` could release it, and that needs the recipient to send a transaction. `PasskeyAccount` has no execute function: it can only sign. Merchant payouts and investor accounts in this product are passkey accounts, so their deferred USDT could never leave the claim.

Fix: `withdrawPendingFor(account)`. Anyone may push `account`'s pending balance to `account` itself and to no other address. Accounting is cleared before the transfer under `nonReentrant`. A transfer that is still refused reverts and the balance stays pending. Tests: `PendingPushV2.t.sol`.

### L-1 Submitter can starve the reputation call (fixed)

`_recordReputation` called the registry with `{gas: 100_000}` and ignored failure. Under EIP-150 the callee receives at most 63/64 of the gas that remains. Anyone who holds the payer's authorization (any relayer, or someone who copies it from the mempool) could therefore pick a gas limit that lets the payment succeed while the record runs out of gas. That denies the payer its on-time record. `test_gasStarvation_cannotSkipTheRecord` found succeeding payments with no record.

Fix: if the call failed and less than `REPUTATION_GAS / 63` gas is left, the payment reverts with `ReputationGasTooLow` and has to be resent with enough gas. A registry that genuinely reverts or burns its full budget still cannot block a payment (existing tests, plus the return-bomb, garbage and re-entry tests).

### L-2 Leaked creator key cannot be revoked during a pause (fixed)

`setCreator` was `whenNotPaused`. After a delegated-creator key leak the guardian pauses the router, but the merchant could not revoke the creator until after unpause, which opened a race. Revoking (`allowed == false`) now works while paused. Granting is still blocked. Tests: `CreatorRevokeV2.t.sol`.

### I-1 Reputation return data copied (fixed)

The low-level call copied the registry's return data. A registry returning about 190 KB added about 170k gas to the payment. The call is now in assembly with a zero output buffer, so the extra cost is bounded by the registry's own 100k budget (`test_returnBomb_extraCostBoundedByTheRegistryBudget`). The registry is set by the owner, which limits the exposure further.

### Informational

- **I-2 Hook path.** The payer signs a nonce bound to `inv.payout`, but when a hook is set the money goes to the hook (the claim) and on to the token holder. The trust anchor is the merchant's SetHook signature plus, after M-1, the hook's own call. Payer clients should read `invoices(id).hook` and show "paying the invoice's holder" when it is set.
- **I-3** A payment on a Listed claim cancels the listing but leaves the router hook on the claim. The invoice stays payable (money goes to the payee) and can no longer be cancelled. No money is at risk.
- **I-4** The `Settled` branch of `onPaid` cannot be reached through the router, because the router stops accepting payments once paid equals face. It is kept as defence in depth and exercised directly by `test_onPaid_afterSettled_goesToMerchant`.
- **I-5 InvoiceAck.** The per-buyer nonce forces acknowledgements to land in signing order, and there is no way to invalidate a signed one before its deadline. The signature covers invoice id (and with it the merchant), amount, due date and buyer, but not the payout. It is advisory evidence only, as documented.
- **I-6 Events.** `InvoiceCreated` omits `payerLock` and `minPayment`, so the indexer must read `invoices(id)`. `DiscountTermsSet` is emitted before `InvoiceCreated` in the same transaction. `refundWithApproval` has no event of its own (the approval is visible through `InvoiceRefunded` plus `usedApprovals`). Pause, unpause and ownership changes emit OpenZeppelin events.
- **I-7** `SignatureChecker` forwards all gas to an ERC-1271 signer. A hostile merchant wallet can burn the submitter's gas (one test used about 1 billion gas with an unlimited limit). The relayer must simulate and cap gas, which it already does.
- **I-8 Trust model.** Owner and guardian are the deployer EOA on staging. `renounceOwnership` exists, and with it a paused contract could never be unpaused. A guardian pause of the claim blocks `list`, `fund`, `markDefault` and transfers, but never customer payments, `withdrawPending*` or `cancelListing` (tested). A router pause also blocks refunds. Move ownership to a multisig before real value.
- **I-9 Cross-version nonces.** v2 `refundNonce` and claim `fundNonce` use the same formula as v1. Replay across versions is impossible because the token authorization's `to` is the contract's own address and the EIP-712 domains differ (name/version `Stenmont PaymentRouter`/`2`, `Stenmont InvoiceClaim`/`2`, plus verifyingContract and chain id). The only shared effect is that reusing the same salt would find the token nonce already used. Clients use random salts.

### Checked and found sound

- No contract keeps customer money: the router's USDT balance is 0 after every call (asserted in every new test and in the claim v2 invariant). The claim holds exactly live reserves plus `totalPending`, and 0 after a complete settlement.
- No double settlement: `markDefault` twice, default after settle, pay after Paid and direct `onPaid` from a non-router all revert. Default and late payment give the same split in either order.
- Re-entry from a hook (into `pay` or `refund`) or a registry (into `refund`) is blocked by the guard and unwinds the payment. ERC-1271 validation runs in a staticcall, so a state-writing wallet is rejected and a malformed answer is rejected.
- Discount rounding favours the merchant (the waived amount rounds down). Refund caps use USDT actually received. A hook is refused on any invoice with discount terms. Claim `price` and `reserve` round down, with `reserve <= price` guaranteed by `discountBps + reserveBps <= 10000`.
- Funding cannot be redirected (the nonce binds the invoice, and `to` is the claim). Racing to fund only changes which allowlisted investor wins.
- Gas starvation of the claim's payout transfer cannot park a payout silently (`test_claim_gasStarvation_neverParksAPayoutSilently`).

## Residual risks

- No external audit. This review, its tests and slither cannot prove the absence of bugs, especially economic or integration bugs between the contracts and the API, indexer and clients.
- M-2 stays open on-chain until the API enforces `payerLock` and bounded `validBefore`, or Hitesh picks an on-chain option.
- The deployed v1 contracts (immutable, staging only) still have M-1, M-3, L-1 and I-1. Keep them for existing obligations only and create no new sales on v1.
- The real official USDT was used only on a fork at one pinned block. Its blocklist and pause behaviour was simulated with mocks, not tested against the real token.
- There is no Foundry deploy script for the v2 set yet. It must be written and reviewed before the redeploy.
- Not run: the 12-agent parallel mode of `solidity-auditor`, the `x-ray` report, the Trail of Bits skills (not installed), live or browser acceptance, `packages/shared` and API tests, and v2 API/web integration (none exists yet).

## Recommendation

**GO** for redeploying the router v2 set on the Whitechain test network, once the checklist below is followed and Hitesh approves. All Medium and Low findings are fixed except M-2. M-2 has tested mitigations and does not affect money until a v2 client exists.

**NO-GO** for switching live API/web traffic to v2 until (1) the v2 API sets `payerLock` and bounded `validBefore` for discount invoices, (2) version routing per `docs/ROUTER-V2.md` is built and tested, and (3) the live regression in step 10 below passes. **NO-GO** for any mainnet or real-value deployment without an external audit and multisig ownership.

## Redeploy checklist (test network only, after Hitesh's yes)

1. **Freeze and snapshot.** Pause creation on the v1 router (the API stops creating invoices). Snapshot `contracts/deployments/1874.json`, API/web/MCP env, indexer cursors, and the open invoices, subscriptions and claims. Keep v1 payable and refundable.
2. **Build from the reviewed commit.** Check out this branch's head, `forge build`, `forge test`, `FOUNDRY_PROFILE=fork forge test`, all green. Write and review a v2 deploy script, and dry-run it with `forge script` without `--broadcast`.
3. **Deploy in order, recording each deployment block:**
   1. `InvestorRegistry(owner, attester)` (or reuse the current one, after a deliberate decision).
   2. `PaymentRouterV2(USDT 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7, owner, guardian, attester, refundThreshold)`. The threshold must equal the API's `REFUND_APPROVAL_THRESHOLD`.
   3. `SubscriptionManager(USDT, owner, guardian)` if it is being redeployed. The old one keeps serving existing agreements.
   4. `InvoiceClaimV2(USDT, routerV2, registry, owner, guardian)`.
   5. `InvoiceAck(routerV2)`.
   6. `ReputationRegistryV2(owner)`, then `setRecorder(routerV2, true)`, then `routerV2.setReputation(reputationV2)`. Never grant the v1 router a v2 recorder role.
   7. `LedgerAnchor()` only if approved.
4. **Read back** owner, guardian, attester, threshold, `reputation()`, `isRecorder(routerV2)`, `claim.router()` and `claim.registry()`, `ack.router()`, and `domainSeparator()` for router (`Stenmont PaymentRouter`/`2`), claim (`/2`) and ack (`/1`) on chain 1874.
5. **Verify** every source on the Whitechain explorer.
6. **Delegation.** Each merchant signs a fresh `SetCreator` for the relayer on the new router (new domain, fresh nonce).
7. **Shared package.** Run `node contracts/script/export-v2.mjs` (the ABIs in `packages/shared/src/abis/v2/` match this branch). Add the new addresses to `contracts/deployments/1874.json` and keep the v1 entries as retired, never erased.
8. **Env (names only):** `ROUTER_ADDRESS`, `ROUTER_DEPLOY_BLOCK`, `SUBSCRIPTION_MANAGER_ADDRESS`, `INVESTOR_REGISTRY_ADDRESS`, `INVOICE_CLAIM_ADDRESS`, `REPUTATION_REGISTRY_ADDRESS`, `USDT_ADDRESS`, `WHITECHAIN_CHAIN_ID`, `WHITECHAIN_RPC`, plus a new reviewed binding for InvoiceAck. Change them only once v2 version routing exists, because swapping the addresses alone breaks v1 calls.
9. **Indexers.** Start each new contract's cursor at its exact deployment block and keep the v1 cursors. Deduplicate on chain, contract, txHash and logIndex. Backfill before reopening creation. Handle the new error names (`NotHook`, `ReputationGasTooLow`) and `withdrawPendingFor`.
10. **Live regression** (record explorer links): checkout, partial payment, discounted payment with `payerLock` and bounded `validBefore`, tampered-payout denial with balances unchanged, refund and refund with World approval, list, fund, pay, settle, default, acknowledgement (including a wrong buyer), subscription, shop. Only then reopen creation.
11. **Rollback.** If any step fails, stop creation and restore the v1 env and ABI imports from the snapshot. Keep v2 index data partitioned and v2 obligations payable through an explicitly versioned path. Never replay v1 signatures on v2, never reset token nonces, never redirect funded claims. Immutable contracts cannot be upgraded back, so a broken v2 is abandoned (paused), not patched.
