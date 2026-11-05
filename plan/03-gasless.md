# Phase 3: Payments nobody notices (Whitechain Scale)

**Goal:** the payer holds no WBT, writes down no seed phrase and sees no crypto words; the business pays the gas and cannot be drained.
**Tech:** Durable Object relayer, OpenZeppelin `P256` / `WebAuthn` (if present in 5.6.1, otherwise vendored daimo verifier), `@simplewebauthn/browser` + `@simplewebauthn/server` 14, viem.
**Depends on:** Phase 2; spike 0.2 (precompile answer).
**Done when:** a fresh browser with no wallet pays an invoice with one tap, the relayer pays the gas, and the drain tests pass.

## Review focus

1. Same signed authorization submitted twice: second call fails and no second gas spend (nonce used).
2. One payer sending 100 requests in a minute: rate limit and per-payer daily cap stop it; relayer WBT spend stays under the daily cap.
3. Tampered WebAuthn challenge, high-s signature, wrong key: `isValidSignature` returns not-magic, payment reverts.
4. Relayer WBT balance below a floor: API refuses with a clear "gas tank empty" error instead of failing mid-way.
5. Counterfactual account address equals the deployed address (payer can receive USDT before the account exists).

### Task 3.1: PasskeyAccount and factory

**Files:** `contracts/src/PasskeyAccount.sol`, `contracts/src/PasskeyAccountFactory.sol`, `contracts/script/DeployFactory.s.sol`, `contracts/test/{PasskeyAccount,P256,DeployFactory}.t.sol`, `scripts/spikes/p256.ts`
**Built on OpenZeppelin 5.6.1** (`SignerWebAuthn`, `P256`, `Clones`), not custom cryptography. The account only validates signatures (ERC-1271); it has no execute or upgrade path. Minimal-proxy clones, CREATE2 addresses that include the public key, creation is permissionless and atomic (create plus initialize).
**Wire format for the browser (Task 3.3):** the signature is the six fields ABI-encoded flat, not as a struct: `abi.encode(r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON)`. The challenge is the 32-byte digest, `s` must be normalised to low-s, and the authenticator must report user presence and user verification.
**Spike 0.2:** the P-256 precompile at `0x100` is live on Whitechain Sepolia (answers a Foundry-generated vector with 1, rejects a tampered one). OpenZeppelin falls back to Solidity if it is ever missing.

- [x] 21 passkey tests (valid, tampered challenge, high-s, wrong key, missing user presence or verification, wrong ceremony type, garbage never reverts, one-time initialize, locked implementation, off-curve keys, factory determinism, nobody can take an address with another key, end-to-end payment through the router, counterfactual deploy-then-pay, fuzz)
- [x] Fork test: a passkey account pays through the real Whitechain USDT over ERC-1271
- [x] slither: only the 7 intentional timestamp notes
- [x] Staging deployment verified: factory `0x5101c37647581c81b462436af2D7ac8ccD08D33A`, implementation `0xf5cA54b1da9fc2E3CAF9CbD17C60D98554cB800C` (the first factory was redeployed after two small slither-driven fixes so the repo matches the chain)
- [x] ABIs and addresses generated into `packages/shared`
- [ ] Commit lines added to `commits.md`

### Task 3.2: Relayer Durable Object with caps

**Files:** `services/api/src/relayer/{sender,do,caps,relay}.ts`, `src/routes/{relay,gasTank}.ts`, `migrations/0003_relayer.sql`, `wrangler.jsonc` (Durable Object), tests `sender`, `relayer`, `cors`; `scripts/{fund-gas-tank,relay-pay}.ts`
**Built:**
- `Relayer` Durable Object (one instance) sends every relayer transaction through a `SerialSender`: one at a time, consecutive nonces, one retry on a stale nonce. Invoice creation now goes through it too, which fixes the Phase 2 nonce-collision limit.
- `POST /relay/pay` (public): rate limits (100 per minute per payer and per IP) -> invoice must be payable -> free pre-check of tank and payer cap -> duplicate guard (one row per authorization) -> simulate (garbage costs nothing) -> relayer balance floor (0.02 WBT) -> atomic gas reservation (tank, daily cap) and payer reservation -> send -> receipt -> settle the real gas cost, release on failure.
- A passkey account that does not exist yet is deployed and paid in one Multicall3 transaction; its address is checked against the key first.
- "Busy" (other payments are holding the budget) is reported as 503 retry, never as the merchant's limit.
- `POST /relay/account` (address, deployed, balance), `POST /relay/faucet` (test environments only, 5 test USDT, once per address per day, 5 per IP), `GET /v1/gas-tank`.
- CORS: only our app origin (and localhost outside production) may call the public endpoints from a browser; `/v1` is never open to browsers.
- Error codes (differs slightly from the first sketch): `invalid_authorization` (not `invalid_signature`), plus `invoice_not_payable`, `overpay`, `wrong_payer`, `account_mismatch`, `relayer_low`, `tx_reverted`, `timeout`, `busy`.

- [x] Failing tests first: 6 sender, 33 relayer, 5 CORS (119 API tests in total)
- [x] Secrets: relayer key already in the Workers; faucet key pushed to staging only
- [x] Live on staging: invoice created through the Durable Object, paid through the public relay by a payer holding 0 WBT (merchant tank charged the real cost, 0.0008 WBT)
- [ ] Commit lines added to `commits.md`

### Task 3.3: Pay page with zero crypto steps

**Files:** `apps/web/app/pay/[id]/{page,PayClient}.tsx`, `apps/web/lib/{pay,passkey}.ts`, `packages/shared/src/webauthn.ts`, tests `web/test/pay.test.ts`, `shared/test/webauthn.test.ts`, `web/e2e/pay.spec.ts`
**Built:** one screen: the merchant, the amount, one "Pay $X" button. The first tap creates a passkey and the account, adds test funds (test environments only), asks for Face ID, a fingerprint or the device PIN, and sends. "Busy" retries quietly with the same approval. Every message is plain words; a test fails if any message contains a crypto word.
- Browser helpers in `shared`: DER signature parsing, low-s normalisation, key extraction from the registration, and the flat encoding. A real assertion generated outside Foundry is checked in TypeScript and in Solidity with the same bytes.
- Playwright with a virtual authenticator, against staging: the customer pays and every distinct text on screen is checked for crypto words; a failed confirmation leaves the invoice open and the button usable; an unknown invoice shows a friendly page.
- Limitation: the account is tied to the browser (the credential id and public key live in local storage); clearing site data loses the link. Recovery is out of scope.

- [x] Unit tests (9) and cross-language vector tests
- [x] Playwright, 3 tests, passing on staging (a full payment takes about 50 seconds including the faucet and the account deployment)
- [ ] Commit lines added to `commits.md`

### Task 3.4: Drain protection under load

**Files:** `services/api/test/drain.test.ts`, `scripts/drain-sim.ts`
- [x] Attack tests: 200 replays of one signature send one transaction (sequential and concurrent); 50 honest payers get through while a replayer costs one; one payer signing fresh authorizations endlessly is stopped by the rate limit and the gas cap; one IP rotating payer addresses is stopped at 100 a minute and by the cap; a flood of invalid authorizations spends nothing. Invariant checked every time: spend is at most the cap and tank plus spend never changes.
- [x] Found and fixed: simultaneous honest payments could be refused as "limit reached" while others held reservations; now reported as busy and retried.
- [x] Live on staging: 15 concurrent replays gave 1 success and 14 duplicates; 120 bad authorizations gave 85 rejections then 35 rate-limits; one payment onchain; the relayer and the merchant tank paid for that one only
- [x] The gas paragraph for the README is in `BUILDER-NOTES.md`
- [ ] Commit lines added to `commits.md`
