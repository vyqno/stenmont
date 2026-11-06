# Stenmont x402 facilitator (Whitechain Testnet, eip155:1874)

A small x402 facilitator for the `exact` scheme on the official USDT (`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, EIP-712 domain `Tether USD` / `1`). The facilitator wallet pays gas; the payer only signs an EIP-3009 `TransferWithAuthorization`. Smart-account (ERC-1271, `bytes`) signatures work.

## Interface
- `GET /supported` -> `{ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:1874" }], extensions: [], signers: {} }`
- `POST /verify` body `{ x402Version, paymentPayload, paymentRequirements }` -> `{ isValid, invalidReason?, payer }`
- `POST /settle` same body -> `{ success, transaction, network, payer, errorReason? }`
- Malformed body -> `400 { error: "invalid_request" }`.

`paymentPayload` = `{ accepted: <requirements>, payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } } }` (decimal strings for numbers).

## Checks (verify, and again at settle)
scheme `exact`; network `eip155:1874`; asset is the official USDT; `to == payTo`; `value == amount`; `validAfter <= now` and `validBefore >= now + 6s`; signature (ECDSA or ERC-1271, on chain); payer USDT balance; nonce unused; `eth_call` simulation of the transfer.
Reasons: `invalid_scheme`, `invalid_network`, `invalid_exact_evm_payload_asset`, `..._recipient_mismatch`, `..._authorization_value`, `..._authorization_valid_before`, `..._authorization_valid_after`, `..._signature`, `insufficient_funds`, `..._authorization_nonce_used`, `invalid_transaction_state`.

## Settle
1. verify; 2. refuse with `facilitator_low_funds` if WBT < floor + worst-case gas (nothing claimed, retry works after refuel); 3. atomically claim `<payer>:<nonce>` in D1 (second call: `duplicate_settlement`, one tx); 4. send via the `Sender` Durable Object (one tx at a time, consecutive nonces); 5. wait for the receipt.
Failure handling: send error or revert frees the claim; receipt timeout keeps it and returns `settlement_pending` with the hash (it may still land).

## Config
Secret: `FACILITATOR_PRIVATE_KEY`. Vars: `WHITECHAIN_RPC`, `MIN_FACILITATOR_WBT_WEI` (default 0.02 WBT). Bindings: `DB` (D1, `migrations/0001_settlements.sql`), `SENDER` (Durable Object).

## Caps and allowlist
Only registered payees are served (`payee_not_allowed`, checked first: no chain call, no claim; applies to /verify and /settle). Add one with `wrangler d1 execute <db> --env staging --command "INSERT INTO payees (address) VALUES ('0x...lowercase')"` (migration `0002_guard.sql`; no public admin endpoint).
After verification and before gas: per-payer rate (`payer_rate_limited`), per-payee daily (`payee_daily_cap_reached`), global daily (`global_daily_cap_reached`). A failed send or revert gives the allowance back. Vars: `SETTLE_MAX_PER_PAYER_MINUTE` (10), `SETTLE_MAX_PER_PAYEE_DAY` (1000), `SETTLE_MAX_GLOBAL_DAY` (5000).

## Limits (honest)
- Caps are fixed windows (UTC day / minute) in D1, not a sliding window.
- Only `exact` + EIP-3009 on USDT; no Permit2, no counterfactual (ERC-6492) accounts.
- A `settlement_pending` claim is not auto-reconciled.
- Not deployed; never run against the live chain yet.
