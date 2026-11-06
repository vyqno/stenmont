# Independent review 1 (Opus 5.5), phase-4-plug-in, 2026-11-06

Review only: the reviewer was asked for findings, not decisions or fixes. It edited nothing and ran offline tests (forge 149, API 245, shared 35, sdk 14, all passing). Items marked "ours" are our assessment.

## Findings (ranked)

1. **High.** A subscription the merchant cancels stays active onchain. Anyone can still call `charge(id)`, and the customer's own cancel returns 404 because the row says `cancelled`. Cause: the merchant is a PasskeyAccount with no execute function, so it can never call `cancel()`; merchant cancel only sets the database row. (`routes/subscriptions.ts`, `SubscriptionManager.sol:127,156`). The indexer also does not watch SubscriptionManager events.
2. **High/Medium.** Invoice creation (and activation, refunds) spends relayer gas with no rate limit and no gas-tank charge. A signed-up key plus fresh idempotency keys can run the relayer down to its floor. (`routes/invoices.ts`, `chain.ts`)
3. **Medium.** A tank can be drained with authorizations that pass simulation and revert when mined (several full-amount authorizations for one invoice sent at once; N-1 revert with `Overpay` and cost gas, and the payer cap is released on revert). (`relayer/relay.ts`)
4. **Medium.** The creator delegation gives the one shared relayer key unlimited invoice power over every delegating merchant (any payout, any amount, never expires). The API pins payout; the contract does not. (`PaymentRouter.sol:119-123`)
5. **Medium/Low.** The human-approval threshold for large refunds is per call, so five 100 USDT refunds avoid approval for a 500 USDT refund. `refundable()` ignores pending refund requests. (`PaymentRouter.sol:215`, `routes/refunds.ts`)
6. **Low/Medium.** Nothing reconciles timed-out transactions: reserved gas, payer-cap usage, `sent` rows and `subscribing` offers stay held.
7. **Low.** Overlapping renewal cron runs can count a `NotDue` revert as a customer failure and mark a subscription `past_due`.
8. **Low.** The session cookie domain `.stenmont.com` is sent to every subdomain (staging, production, shop).
9. **Low.** On "already known" the sender retries with a fresh nonce and can broadcast a payment twice (the duplicate reverts and burns gas).
10. **Low.** A gas tank can go negative (reservation uses `gasPrice()`, actual cost can be higher).
11. **Low.** Idempotency keys are not bound to the route or the request body.
12. **Low.** A leaked API key cannot be revoked or rotated by the merchant (no revoke route, no expiry, scope `*`).
13. **Low.** Passkey registration accepts any credential id and key pair (no attestation); the same public key can be registered for several businesses; the existence check and insert can race into a 500.
14. **Info.** PasskeyAccount: WBT/other tokens sent to an account are stuck (no execute); no recovery; the payer's link to its account lives in localStorage; no ERC-7739 rehashing; RP id and origin are not checked onchain.
15. **Info.** `rate_limits` grows without limit; no cap on webhook endpoints per merchant; SSRF filter blocks literal IPs only; if `queue.send` fails after a delivery row is inserted it is never queued; two concurrent subscribes sign "allowance + cap" from a stale read; USDT sent directly to the router is unrecoverable.

## Checked and found correct
Payment and refund nonces are bound to the invoice (no redirection); checks-effects-interactions with a transient guard; refund bounds per payer; setCreator nonce and single-use approvals; OpenZeppelin WebAuthn requires UV/UP/low-s; clones locked and initialised atomically; SubscriptionManager catch-up, boundary and cap logic; server WebAuthn checks (challenge, origin, rpIdHash, UV, single-use challenges, counter compare-and-swap); tenant isolation on every `/v1` query read; CSRF and CORS tied to APP_URL; `cf-connecting-ip` not spoofable on Workers; CSV formula escaping; constant-time webhook HMAC; money math in bigint; ens-setup never prints keys.

## Claims the reviewer could not verify
100% coverage (did not run `forge coverage`); the fork tests and slither; the live staging runs; invariants are real but weak (only honest actions: no attacker, hooks, creator path or `refundWithApproval`); "daily USDT cap per payer" is per merchant and payer, not global.

## Ours: what to do with it
Items 1, 2 and 5 are real and worth fixing before the demo. Item 1 needs a contract change (a merchant-by-signature cancel) or at minimum letting the customer cancel regardless of the row, plus an indexer for subscription events. Item 4 and 12 are design/trust notes for the README's limitations. Fixes are tracked in `BUILDER-NOTES.md`.
