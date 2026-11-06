# Relayer gas accounting

How a payment's gas is paid for, and what keeps the books right when many payments arrive at once.

## The flow

1. **Reserve.** After the simulation succeeds, the worst-case cost (`gas x 1.25 x gasPrice`) is moved from the merchant's tank balance into `spent_today`. This is one compare-and-swap on `gas_tanks.version`, so concurrent requests cannot overspend the balance or the daily cap. A request that loses 8 swaps in a row is told `busy` and holds nothing; the pay page retries quietly.
2. **Send** through the Durable Object (one transaction at a time, consecutive nonces).
3. **Settle** after the receipt: the reservation is replaced by the real cost (`gasUsed x effectiveGasPrice`). If anything fails before the send, the reservation is released (settled at 0).

At every moment `balance + spent_today = what the tank started the day with, minus nothing`: reserving only moves wei from one column to the other, and settling only moves the unused part back.

## The race that was found

`settleGas` and `releasePayer` shared the retry loop of the reservation. That loop gives up after 8 lost swaps and returns `"busy"`. Callers of the settle path ignored the return value. With about 50 simultaneous payments one row is contended by 50 writers, and a loser can need up to 50 tries, so some settlements were silently dropped: the full worst-case reservation stayed charged (about 1.7x the real cost per dropped settlement) and, for releases, a payer's daily allowance stayed consumed for a payment that never happened. Nothing was ever double-settled; money was never created. Gas was only over-charged to the merchant, and only under heavy concurrency, which is why the "50 honest payers" drain test seemed to depend on timing.

Reproduced deterministically in `services/api/test/relayerRace.test.ts` (a seeded scheduler makes each D1 statement and chain call wait a random number of microtask turns). Before the fix 19 of 19 scenarios failed; the same scenarios fail again if the settle bound is put back to 8.

## The fix

- Settling and releasing retry until written (bound 1,000, then they throw). Each lost swap means another writer succeeded, so this terminates; it is never abandoned silently.
- `GasHold` wraps one reservation: `settle`/`release` act at most once, a second call does nothing, and a failed write can be retried. `relayPay` and `sendFromTank` use it, and `relayPay`'s cleanup is idempotent and always frees the authorization row.
- If a settlement cannot be written the full reservation stays charged (over- never under-charged) and the error is logged.
- A reservation settled after midnight UTC corrects only the balance; it no longer overwrites the new day's `spent_today`.
- The drain test now waits between retries and has an explicit 30 s timeout. It measured loop speed, not behaviour.

## Durable receipt recovery (local implementation)

Migration0070 journals new gas holds atomically with the reservation. Immediate settlement and minute-cron recovery share a durable, atomic settlement marker. A confirmed receipt refunds unused gas once; a confirmed revert also releases the original payer allowance once. Missing receipts, RPC failures and unidentified broadcasts remain held. The recovery path never broadcasts or re-signs.

A send RPC error now returns an uncertain timeout rather than releasing resources: acceptance may have happened before its response was lost. Payment authorization and payer allowance remain reserved, preventing that authorization from being broadcast again. Generic calling workflows still own their operation idempotency.

Historical rows without the original reservation amount and crashes before a returned hash is persisted cannot be safely inferred. They require operator reconciliation or a future sender outbox. Generic gas costs are journaled but are not a new Books input in this change. See [durable recovery boundaries and tests](W10-RECOVERY.md). No live staging recovery is claimed.
