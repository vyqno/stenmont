# Contracts: the full onchain suite (read before Phases 2, 3, 5 and 7)

**Goal:** every rule the product promises is enforced in Solidity, not in the app. Tested to the edge cases with unit, fuzz, invariant and fork tests, then audited.
**Standard:** the installed `ethskills` testing rules. A green suite is not proof. Tests assert properties (conservation, monotonicity, access boundaries), not the implementation back to itself.
**Tech:** Solidity 0.8.38, Foundry 1.9.0, OpenZeppelin 5.6.1 (`EIP712`, `SignatureChecker`, `Ownable2Step`, `Pausable`, `ReentrancyGuardTransient`, `SafeERC20`, ERC-721).

## The suite

| # | Contract | Enforces onchain | Phase |
|---|---|---|---|
| C1 | `PaymentRouter` | Invoice lifecycle, partial pay with a minimum, payer lock, due date, refunds only to real payers up to what they paid, payment authorizations bound to one invoice (no relayer redirection), merchant delegation, payout hook, pause, human approval for large refunds | 2 |
| C2 | `PasskeyAccount` + `PasskeyAccountFactory` | P-256 WebAuthn signatures as ERC-1271, counterfactual addresses | 3 |
| C3 | `SubscriptionManager` | Recurring pulls inside a signed allowance, cancel any time, no charge before due | 4 |
| C4 | `PayoutRegistry` | A merchant's payout address with a timelocked change that needs a World-attested approval | 5 |
| C5 | `SpendPolicy` | Agent spending limits (per transaction and per day) and expiry, above-limit actions need a World-attested approval | 5, 6 |
| C6 | `StenmontResolver` (ENSv2) | Invoice holder, reputation and payout records resolve from the contracts, so ENS names always point at current truth | 5 |
| C7 | `InvestorRegistry` | Investor allowlist from attested World proofs, with expiry and revocation | 7 |
| C8 | `ReputationRegistry` | Payer record (paid, on time, late, volume) written only by the router | 7 |
| C9 | `InvoiceClaim` (ERC-721) | Sell an invoice at a discount; the claim token can move only between allowlisted investors; payment routes to the holder; reserve and default | 7 |
| C10 | `OrderFinancing` | Staged funding where importer, exporter and bank each confirm a milestone before the next tranche | 7 (stretch) |
| C11 | `SupplierProgramme` | A buyer's pre-approved supplier invoices fund at a preset rate | 7 (stretch) |

Shared rules: owner is two-step (`Ownable2Step`), a guardian can pause, no contract ever keeps customer money after a call (only `InvoiceClaim` holds a merchant's reserve, by design), all signatures are EIP-712 and work for smart accounts (ERC-1271).

## Test matrix (every contract needs all five)

1. **Unit:** every function, every revert (`vm.expectRevert` with the exact error), every event with exact arguments.
2. **Access:** each privileged function called by a non-privileged account, by zero address, by the contract itself.
3. **Fuzz:** every number that feeds value math, across its whole domain (amounts, minimums, dates, thresholds), with the boundary, the nearest valid value and the first invalid value named in the test.
4. **Invariant (handler-driven):** conservation between accounting and custody, one-sided bounds checked both ways, several actors, `fail_on_revert` on while building, and the calls/reverts statistics read every run.
5. **Fork:** against the real USDT on Whitechain Sepolia at a pinned block, never only a mock. Run with `forge test --profile fork`.

## Gates before a contract counts as done

- [ ] `forge test` green, fork profile green
- [ ] `slither .` has no high or medium finding left unaddressed
- [ ] No test only mirrors the implementation
- [ ] After the whole suite is finished: run the installed Pashov skills `solidity-auditor` (and `x-ray` for the pre-audit report), then Trail of Bits `building-secure-contracts` style review (`npx skills add trailofbits/skills`). Fix every finding or record why not.

## Status

| Contract | Unit | Fuzz | Invariant | Fork (real USDT) | slither | Done |
|---|---|---|---|---|---|---|
| C1 `PaymentRouter` | 67 | 11 (1,000 runs each) | 3 properties, 25,600 calls, 0 reverts | 8 | no high or medium (7 intentional timestamp notes) | yes, 100% line, statement, branch and function coverage |
| C2 `PasskeyAccount` + factory | 22 | 1 (256 runs) | n/a (stateless) | 1 | only the intentional timestamp notes | yes |
| C3 to C11 | not started | | | | | |

slither note: it cannot parse OpenZeppelin's transient-storage reentrancy guard (`ReentrancyGuardTransient`), so for a complete run use a temporary copy that swaps in `ReentrancyGuard`. Run with `~/.venvs/slither/bin/slither . --filter-paths "dependencies|test|lib" --exclude-dependencies`.
