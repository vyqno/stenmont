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

**Files:** Create `contracts/src/PasskeyAccount.sol`, `contracts/src/PasskeyAccountFactory.sol`, `contracts/test/PasskeyAccount.t.sol`
**Produces:**
```solidity
// PasskeyAccount
function initialize(bytes32 x, bytes32 y) external;
function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4); // 0x1626ba7e if valid
// PasskeyAccountFactory
function createAccount(bytes32 x, bytes32 y, bytes32 salt) external returns (address);
function getAddress(bytes32 x, bytes32 y, bytes32 salt) external view returns (address); // CREATE2, counterfactual
```
`signature` = abi-encoded WebAuthn assertion (authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s); the challenge must equal `hash`. Accounts are minimal proxies (clones) of one implementation.

- [ ] Failing tests using `vm.signP256` with a fixed key: `test_validAssertion_returnsMagic`, `test_tamperedChallenge_returnsInvalid`, `test_highS_returnsInvalid`, `test_wrongKey_returnsInvalid`, `test_getAddress_matchesCreateAccount`, `test_endToEnd_accountSignsReceiveAuth_andRouterPays` (account holds USDT, signs the 3009 digest, router `pay` succeeds)
- [ ] Run `forge test --match-contract PasskeyAccountTest` → FAIL
- [ ] Implement; if spike 0.2 failed, rely on the library's Solidity fallback and record the gas in `BUILDER-NOTES.md`
- [ ] Run → PASS
- [ ] Deploy factory (`script/DeployFactory.s.sol`) and verify; add `PASSKEY_FACTORY` to `addresses.ts`
- [ ] Commit line: `feat: add passkey smart account and factory`

### Task 3.2: Relayer Durable Object with caps

**Files:** Create `services/api/src/relayer/{do.ts,caps.ts,routes.ts}`, `services/api/migrations/0003_relayer.sql`, `services/api/test/relayer.test.ts`
**Produces:** tables `relayer_txs(id, merchant_id, kind, request, tx_hash, status, gas_used, wbt_cost, idempotency_key UNIQUE)`, `gas_tanks(merchant_id PK, wbt_balance, daily_cap_wbt, spent_today_wbt, per_payer_daily_cap_usdt)`. Route `POST /relay/pay` body `{invoiceId, value, auth: {payer, validAfter, validBefore, nonce, signature}}` → `{txHash}` or `4xx {error:{code,message}}` with codes `gas_tank_empty`, `payer_cap`, `rate_limited`, `invalid_signature`, `duplicate`. `Relayer` is a Durable Object class holding the relayer key (Worker secret `RELAYER_PRIVATE_KEY`); it serialises sends so nonces never collide.
**Function:** `checkCaps(db, merchantId, payer, valueUnits: bigint): Promise<"ok"|CapError>`.

- [ ] Failing tests: `duplicate nonce → 409 duplicate, no second tx`; `101st request in a minute from one payer → 429 rate_limited`; `payer over per_payer_daily_cap_usdt → payer_cap`; `gas tank empty → gas_tank_empty before any tx`; `simulate fails (bad signature) → invalid_signature, no gas spent`; `10 concurrent valid requests → 10 distinct nonces, all succeed`
- [ ] Run → FAIL
- [ ] Implement: validate, `checkCaps`, `simulateContract` (viem) against the router, then send through the Durable Object; record `relayer_txs`; decrement gas tank by actual `gasUsed * gasPrice`
- [ ] Run → PASS
- [ ] `npx wrangler secret put RELAYER_PRIVATE_KEY` (value from `.env`, never printed); `npx wrangler deploy`
- [ ] Live check: `scripts/relay-demo.mjs` pays an invoice with `DEMO_PAYER` holding zero WBT: `cast balance $STENMONT_DEMO_PAYER_ADDRESS` stays `0` and the invoice is paid
- [ ] Commit line: `feat: add gas relayer with caps`

### Task 3.3: Pay page with zero crypto steps

**Files:** Create `apps/web/app/pay/[id]/page.tsx`, `apps/web/lib/passkey.ts`, `apps/web/app/api/passkey/route.ts`, `apps/web/e2e/pay.spec.ts`
**Produces:** `createPasskeyAccount(): Promise<{address: Address, x: Hex, y: Hex}>` (WebAuthn create, then factory `getAddress`), `signAuthWithPasskey(digest: Hex): Promise<Hex>` (WebAuthn get with `challenge = digest`, returns the encoded assertion). The page shows amount, merchant name, one "Pay" button; no words "wallet", "gas", "chain", "USDT" beyond the amount formatted as `$12.50`.
**Funding for the demo:** a "Add test funds" button (test environment only) transfers USDT from a funded demo wallet to the new account; production copy is out of scope.

- [ ] Failing Playwright test with a virtual authenticator: open `/pay/<id>` for a seeded invoice, click Pay, expect text "Paid" and the invoice `status` = `paid` in the API; assert the page HTML contains none of `gas|WBT|seed|chain|wallet` (case-insensitive)
- [ ] Run `pnpm --filter web e2e` → FAIL
- [ ] Implement the page and helpers
- [ ] Run → PASS
- [ ] Commit line: `feat: add zero-crypto pay page with passkey`

### Task 3.4: Drain protection under load

**Files:** Create `services/api/test/drain.test.ts`, `scripts/drain-sim.mjs`

- [ ] Test: 50 distinct payers each below caps, plus 1 payer replaying one signature 200 times; assert total relayer spend ≤ `daily_cap_wbt` and exactly one tx for the replay
- [ ] Run → PASS (if FAIL, tighten `caps.ts` first)
- [ ] Write the "how the business pays gas, how the relayer gets WBT, what stops draining" paragraph into `BUILDER-NOTES.md` for the README (Scale requires it)
- [ ] Commit line: `test: add relayer drain protection tests`
