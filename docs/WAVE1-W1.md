# Wave 1 contracts evidence

Source-only candidate. No broadcast, deployment, contract verification, wallet funding or active-client migration performed. V1 source, ABI entrypoint, deployments and client nonces remain unchanged. W9 requires owner approval and a separate activation implementation/review.

## Progress
- 17:37 IST — isolated router/claim v2, acknowledgement and merchant-signed ledger anchor implemented; v1 retained.

## Validation

- Full Foundry suite: 448 passed, 0 failed across 27 suites. Two additional boundary tests then passed in the final targeted 180-test run; no production source changed afterward.

- Foundry targeted v2 regressions: 180 passed, 0 failed (excluding handler suite); includes two fuzz tests at 1,000 runs each.
- Handler: 256 runs, 25,600 calls, zero reverts; deliberate attacks counted and checked, router zero balance and claim reserve+pending liabilities checked, state transitions and holder cap checked. Foundry groups its invariant functions into one reported invariant suite.
- Real official Whitechain Sepolia USDT fork: block 12,308,524, 10 passed, 0 failed. Includes real token domain, replay, invoice redirection, refund, EOA, ERC-1271 smart wallet, passkey account and early discount settlement. Forks only; no transaction sent.
- Shared package: 47 tests passed across 8 files; `tsc --noEmit` passed. Isolated v2 nonce vector matches Solidity and independent `cast abi-encode`/`cast keccak` result. V1 helper is unchanged.
- `node contracts/script/export-v2.mjs` deterministic (second execution gives no diff). V2 ABIs live under `packages/shared/src/abis/v2/`, without exporting through the active ABI entrypoint.
- Targeted coverage (`forge coverage --ir-minimum --match-path 'test/v2/*' --no-match-contract InvoiceClaimV2InvariantTest --report summary`): RouterV2 lines 98.77%, branches 100%; ClaimV2 lines 97.66%, branches 97.37%; InvoiceAck lines 100%, branches 100%; LedgerAnchor and ReputationRegistryV2 lines/statements/branches/functions 100%. **The requested 100% coverage of all new money paths is not established; this remains an activation gate.**

## Static analysis

Slither ran all source contracts with 102 detectors, both native transient guards (46 reports, with transient-IR parsing warnings) and a disposable storage-guard source copy (48 reports). These are findings to review, not a clean security sign-off. Reports were retained outside git for the lead.

- Timestamp findings are intended expiry/due/discount boundaries; tests cover exact expiry behavior.
- `setReputation(0)` deliberately disables recording; zero-check warning is expected.
- Missing inheritance concerns v1 ReputationRegistry, unchanged here.
- Claim payout/deferred-balance reentrancy reports also exist in v1. Official USDT is the supported token; guarded entrypoints, router-only onPaid and state-before-payout accounting constrain callbacks. W1 preserves this design, with attacker and reserve-accounting invariants. Full independent threat review remains required; do not call Slither clean.
- Return-bomb warning on the gas-capped optional reputation call is inherited from v1's pattern. Reverting/gas-burning registries are tested. Arbitrarily large return-data behavior has not been proven safe; review or explicitly discard return data before activation.

## Limits and owner actions

Literal zero claim balance after funding is incompatible with the existing reserve/deferred-payout economics. Balance equals live reserves plus pending liabilities; successful complete settlement drains the claim. Do not describe this as zero funds held. Removing reserves requires an explicit economics decision.

Acknowledgement is advisory evidence, not a claim eligibility gate or legal waiver. Reputation counts distinct merchant addresses, not verified independent humans; a final dust payer gets no reputation for a split-payer invoice. Underwriting must separately filter verified merchants. No live API/web acknowledgement or v2 payment integration is claimed here.

Not run: browser/live acceptance, any deploy/verification, independent Solidity audit skills, whole-monorepo TypeScript tests/lint/build. Held: owner router-v2 yes/no, review of coverage/static findings, exact v2 API/client activation and dual-version indexer migration in ROUTER-V2.md.
- 17:39 IST — full Foundry, real-USDT fork, isolated shared vectors and both Slither modes completed; coverage/security activation gates documented.
