# Durable gas receipt recovery

Local implementation, not deployed or verified against staging yet. Migration **0070_gas_holds.sql** must precede the matching API deployment. No new secret or contract is required.

## Durable accounting

Every new `holdGas` reservation now writes a `relayer_gas_holds` journal entry in the same D1 transaction as the tank debit. The tank version compare-and-swap must succeed before that entry is inserted. A failed insertion rolls back the debit. Both payment relays and generic `sendFromTank` operations use this path.

A transport error during submission is treated as an unknown broadcast outcome: gas remains held, and a payment authorization and its payer allowance remain reserved. Retrying that payment authorization is refused instead of broadcasting again. Generic operation idempotency still belongs to its calling workflow. Once a broadcast hash is returned, the hold stores that hash; payment holds also bind the existing relayer transaction, payer and reserved USDT allowance. No payment signature is persisted in this journal. The hash has a unique index, preventing the same transaction being attached to multiple holds.

Immediate settlement and scheduled recovery share one routine. A confirmed receipt determines actual WBT gas cost. A version-checked transaction refunds the unused reservation and writes its durable settled marker; a linked payment transaction receives its actual gas fields and success/reverted state in that same transaction. Another caller cannot refund the same hold again. A reverted payment releases its original payer allowance using a separate atomic update and durable release marker. A crash between those steps is retryable. Later UTC-day counters are preserved.

D1 batches provide transaction rollback and prevent statements from interleaving. The following statement uses SQLite `changes()` to admit its marker only when the preceding compare-and-swap changed one row. Primary references checked 2026-11-06: [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [SQLite changes](https://www.sqlite.org/lang_corefunc.html#changes).

## Scheduled receipt checks

The existing API minute trigger calls `runGasRecovery`. It checks at most twenty journal entries, ordered by last check time to avoid starving later holds. Production receipt lookups use the configured confirmation count (default two), bounded RPC calls, and never broadcast, re-sign or replay a transaction. Missing receipts and RPC errors retain the complete reservation. A receipt marks transaction execution only; invoice payment recognition remains the indexer's responsibility.

The install-proof store was already configured with its staging-only fifteen-minute trigger and already invoked its guarded maintenance function. No new trigger was added. Its scheduled-handler regression now proves that creating/open abandoned fixtures are retired through that same path while a paid receipt stays paid. Configuration checks prevent accidentally moving this trigger to the top level or a production environment.

## Limits

- Historical sent rows lack the exact reserved gas amount. They are deliberately not inferred or refunded. Operator reconciliation is required for that legacy backlog.
- A crash after network broadcast but before the returned hash is persisted leaves an unidentified hold. It remains charged; no automatic resend or speculative refund is attempted. A durable sender outbox would be needed to close that separate gap.
- Pre-send held rows are not automatically released after a timeout, because a missing hash does not establish that nothing was broadcast.
- Generic gas holds now retain actual costs in their journal. This change does not add that new source to Books; existing payment relayer rows continue to carry measured gas there.
- Settled journal retention and operator recovery UX remain future work. This is not a production readiness or security certification.

## Local verification

Receipt regressions cover a later successful receipt, reverted receipt, concurrent/repeated cron settlement, unknown/RPC-failed receipt, next-day accounting, generic tank sends, rollback faults in journal/transaction writes, atomic reservation failure, legacy rows and separate merchant tanks. The existing fifty-payer contention scenarios pass with the durable journal.

The SQLite D1 fixture was corrected to execute batch SQL synchronously within its transaction. Previously it yielded between statements and permitted nested transactions that real D1 cannot interleave. Adversarial scheduling still occurs before batches and ordinary operations.

- Receipt/relayer/race run: 65 passed before three rollback regressions and two additional legacy/merchant cases were added.
- Final receipt/relayer/race run after the unknown-send fix: 72 tests passed, including eleven receipt regressions; API TypeScript passed.
- Complete install-proof package: 59 tests passed; its TypeScript passed.
- Wrangler API bundle: `deploy --dry-run --env staging` passed; no deployment occurred.
- Final complete API package: **1,074 passed across87 files** after the unknown-send change.

Not run: staging migration, live receipt timeout/recovery, live cron observation, any broadcast, browser flow, wallet funding, contract changes, deployment or push.

- 20:29 IST, 2026-11-06: completed local recovery verification and scheduled cleanup checks; staging remains not run.
