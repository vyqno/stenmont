# Books and verifiable month snapshots

Updated 2026-11-06 17:39 IST. Local implementation; staging and browser verification are still pending.

## What is available

`/dashboard/books` reconciles recorded invoice payments, refunds, financing advances and reserve settlement, plus relayer transaction gas costs. It shows short/overpayments and other review flags. Cash movements are in USDT base units (six decimals); gas costs remain WBT wei (18 decimals). A named, caller-supplied gas conversion rate is supported by the pure reconciliation module; no automatic rate is invented. The dashboard currently uses WBT without conversion.

Tax is a per-invoice, tax-inclusive rate/label, with display/export treatment only. Optional early-payment terms in the pure module produce discount lines; this does not enable new router discount behavior. No tax advice, filing or jurisdictional compliance is implied. Imported invoices and offchain income are not independently proven.

A close freezes the reconciliation snapshot and signs the entire bundle with the service key. Later events never rewrite a locked export. Payments, refunds, financing funding/settlement and gas first observed after their source month closes become adjustments in the first eligible later unlocked month. The source month remains identified by `adjustmentFor`. These dates are UTC. The API's existing event timestamps reflect indexed records; the bundle does not attest an independently fetched block timestamp for each line.

Only ended months can be finally closed. On **staging only**, the current month can be explicitly closed with `{"interimStaging":true}`. This is labelled `closeKind: "interim_staging"`, with the real `closedAt` cutoff and only sources before that cutoff. It is a testing snapshot, not a final accounting month. Later arrivals in that month move to a later month. Future months are refused. A second close, including a concurrent request, is refused with 409. The dashboard explicitly labels the staging choice.

## API

All routes require the authenticated merchant session or API key. Source reads, observations, locks, proofs and anchor records are scoped to that merchant.

- `GET /v1/books/YYYY-MM`: live reconciliation or the immutable locked snapshot, public service signer, lock and anchor state.
- `POST /v1/books/YYYY-MM/close`: service-signed close; an optional explicit staging interim flag is described above.
- `GET /v1/books/YYYY-MM/bundle`: full signed JSON bundle (404 before close).
- `GET /v1/books/YYYY-MM/proof/SEQ`: complete line, leaf hash, siblings and root (SEQ starts at 1).
- `GET /v1/books/YYYY-MM/export/ledger`: every ledger line, WBT included, with source receipt hash and complete ledger hash.
- `GET /v1/books/YYYY-MM/export/quickbooks`: the existing three-column cash-statement layout.
- `GET /v1/books/YYYY-MM/export/xero`: USDT cash-statement movements only.
- `GET /v1/books/YYYY-MM/anchor-intent`: configured registry's merchant nonce and EIP-712 intent for an already closed, nonempty bundle.
- `POST /v1/books/YYYY-MM/anchor`: `{signature, deadline}` from the merchant; the root and line count are always loaded from the locked bundle. A deadline more than an hour away or in the past is refused.

CSV files escape formulas in descriptive text. Bank-statement exports contain signed USDT cash movements, not WBT costs, memo lines or journal/tax integrations. Amounts are USDT units, not an invented USD conversion; an accountant must approve the destination account and currency mapping. The generic ledger is the complete export.

The Xero fields Date, Amount, Payee, Description and Reference were checked against [Xero Central: import a CSV bank statement](https://central.xero.com/0/article/Import-a-CSV-bank-statement), accessed 2026-11-06 through its indexed primary guidance. Date and Amount are required; the other fields aid reconciliation. This implementation emits `*Date,*Amount,Payee,Description,Reference`, ISO dates and signed amounts. Select the corresponding date/column mapping during import. The vendor template was not downloaded and a live Xero import has **not** been run; this is a statement-file export, not a connected Xero integration.

## Exact encoding and verification

The close root commits **every complete ledger line**, including sequence, description, amount, accounts, currency, date, transaction hash, adjustment period and source `leafId`.

1. Canonical JSON recursively sorts object keys lexicographically; arrays retain their order. Bigints are decimal JSON strings, with no leading zeros. Exported snapshot values are JSON-compatible strings/numbers/null; there are no undefined fields. There is no whitespace.
2. Complete line leaf = `keccak256(UTF8(canonicalJSON(["stenmont.books.line.v1", merchantId, period, completeLine])))`.
3. Sort the 32-byte leaves ascending. Each parent is `keccak256(min(left,right) || max(left,right))`, concatenating the raw 32-byte hashes. An odd last node is carried unchanged, **not duplicated**. Empty root is 32 zero bytes. A one-leaf tree's root is the leaf itself. Sibling proofs omit levels where an odd node was carried.
4. `ledger_line_hash` in the generic API CSV is this complete-line hash. The older `leaf_id` column is a **source receipt hash**, which can be shared by several accounting lines; it is not the complete-line root leaf. Use the proof endpoint's full JSON line for verification.
5. The supplemental source receipt preimage is lower-case `txHash|invoiceId|amount|kind`, UTF-8, amount a nonnegative decimal base-unit string, ids 32-byte hex, kind lower-case letters/underscores. A missing gas invoice uses the zero id. These source hashes provide references; the signed close uses the stronger complete-line encoding above.
6. The service signs EIP-191 `signMessage({message:{raw:digest}})`, where `digest=keccak256(UTF8(canonicalJSON(bundle excluding signature)))`. The signed fields include version, close kind, merchant id, period, closedAt, root, line count, complete snapshot and signer.

`verifyMonthBundle(bundle, expectedSigner)` in `packages/shared` verifies the signature, period/line count and recomputed complete-line root without network access. Pin `expectedSigner` from trusted service configuration; trusting a signer supplied only by an untrusted bundle defeats authentication. `apps/web/lib/booksProof.ts` independently implements line encoding and proof verification without importing the shared encoder/tree. The two implementations use fixed three-line vectors independently calculated with Foundry `cast keccak`, including the odd-node carry case. Changing one amount or merchant fails verification. A valid inclusion proof alone authenticates a line only after its root is trusted through the signed bundle or confirmed registry state.

## Configuration and held chain work

- `BOOKS_SIGNING_KEY`: Cloudflare secret, a generated secp256k1 private scalar encoded as `0x` plus 64 hex characters (32 bytes). The lead must generate it privately and configure staging; it has not been generated here. Never return/log the value. Its derived public Ethereum address is the service verification signer and is returned as `signer`. Publish/pin that address separately for offline auditors. Key rotation requires keeping old expected signer addresses for historical bundles.
- `ANCHOR_REGISTRY`: public address, unset until a compatible registry is separately deployed and approved. No registry was deployed by this workstream.
- Apply migration **0041_invoice_tax.sql** before deploying these routes. It contains invoice tax columns, locked bundles, first event observations and confirmed anchor references. It has not been applied to staging. Like prior migrations in this repository, raw SQL is authoritative; generated Drizzle journal/snapshots were not changed.

The bundle signature is a **service attestation**, not a merchant/passkey signature. The registry adapter separately requires merchant consent using the LedgerAnchor EIP-712 domain `Stenmont LedgerAnchor`, version `1`, current chain id and configured registry. Its fields are merchant, periodId, root, lineCount, nonce and deadline; periodId is `keccak256(UTF8(YYYY-MM))`. The contract's EOA/ERC-1271 validation authorizes the merchant signature. The API never signs merchant consent with the service key.

`anchorMonth(root, period, lineCount, adapter)` is injectable. The real adapter exists only with `ANCHOR_REGISTRY`, uses `sendFromTank` for cap/reservation enforcement, waits for a successful receipt, then reads the registry's recorded root and line count and compares them before storing/displaying `anchored`. An accepted hash, pending/reverted receipt, mismatch or RPC failure is not an anchored result. A retry after an uncertain receipt may require inspecting the registry; no receipt-timeout recovery claim is made here. No chain transaction has been submitted by this workstream. The dashboard shows anchor status and a confirmed receipt link, but its merchant passkey anchor-signing ceremony remains to be integrated after the contract deployment decision.

Gas coverage is limited to recorded relayer transaction rows with measured `wbtCost`, including reverted transactions. Operations not represented in that table cannot be silently claimed as measured costs. No exchange-rate provider, live Xero/QuickBooks import, browser run, staging migration or onchain anchor has been verified here.
