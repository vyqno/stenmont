# Invoice contract version routing

New invoice creation defaults to v1 while `INVOICE_DEFAULT_VERSION` is unset or `1`.
Only the coordinated acceptance cutover sets it to `2`. `INVOICE_CREATION_PAUSED=yes`
blocks new invoices through the common creation path, including store checkout.
During regression only, `INVOICE_ACCEPTANCE_MERCHANT_ID` may name one retained
staging merchant. The exception requires staging and explicit v2 creation;
production ignores it. Other merchants stay frozen, and all verification,
delegation, rate limits and money-signature rules still apply.
Neither flag redirects existing obligations or pauses repayment/refund paths.

Keep the existing v1 bindings permanently: `ROUTER_ADDRESS`, `ROUTER_DEPLOY_BLOCK`,
`INVOICE_CLAIM_ADDRESS`, `INVESTOR_REGISTRY_ADDRESS`, `REPUTATION_REGISTRY_ADDRESS`
and `SUBSCRIPTION_MANAGER_ADDRESS`. Add separate v2 bindings:

- `ROUTER_V2_ADDRESS`, `ROUTER_V2_DEPLOY_BLOCK`
- `INVOICE_CLAIM_V2_ADDRESS`, `INVOICE_CLAIM_V2_DEPLOY_BLOCK`
- `INVESTOR_REGISTRY_V2_ADDRESS`, `REPUTATION_REGISTRY_V2_ADDRESS`
- `INVOICE_ACK_ADDRESS`

Migration0071 receipt-classifies the29 proven staging creation transactions:
17 use the retired router and no claim deployment;12 use current v1 and its
claim. The failed row with no creation receipt stays unassigned and unpayable.
The migration aborts on any unmatched successful/creating row, so a creation
racing the inventory must be classified rather than inferred. The classification was generated from the lead's read-only chain1874 evidence
at block12389975, not from invoice age or the current creation default. New rows
save their version, router, claim and payout at creation. A database trigger
refuses later changes. The known retired v1 router has its own read/pay/refund
adapter and cursor; it never receives new creation or financing, and unsupported
replacement-cancellation is explicitly refused. No claim address is fabricated
for it. Archived ABI entries for invoice reads, pay/refund and token nonces match;
the old implementation retains older security boundaries, including per-call
refund approval. The API still enforces its stricter cumulative World gate.
Missing, invalid or mismatched configuration fails closed. No v2 failure falls
back to v1. Invoice numbers remain unique per business across versions.

## Merchant delegation

An existing passkey account needs a fresh v2 `SetCreator` signature; its v1 grant
has no effect on the new router. `GET /v1/router-delegation?contractVersion=v2`
returns the actual creator nonce, ten-minute deadline, typed data, digest and
base64url challenge. `POST /v1/router-delegation` accepts
`{contractVersion:"v2",deadline:number,signature:hex}`. Simulation, merchant gas
caps and the onchain signature/nonce checks precede confirmation. Readback must
confirm the grant. Invoice creation returns `creator_delegation_required` until
that readback permits the creator; the API never fabricates a grant.

## Invoice and payment interface

Invoice and public pay responses include `contractVersion`, `routerAddress`,
`claimAddress`, `payout`, `payerLock`, `minPayment` (decimal USDT), `discountBps`,
`discountUntil` (unix seconds), and `hook`. Public v2 views read current terms
from storage and refuse a payout mismatch. Client independent payout checks are
still required; API output alone is not an independent ENS trust anchor.

Creation accepts `buyerAddress`, `discountBps`, and ISO `discountUntil`. Discount
terms require a v2 invoice and a nonzero named buyer: the API sets `payerLock` to
that buyer, never to an arbitrary separately supplied lock. The pay request
requires `expectedPayout` for v2 and encodes the v2 payout-bound token nonce.
Wrong buyers and discounted amounts with an authorization beyond
`discountUntil+1` are refused before gas. Late discounted submissions are
refused rather than becoming partial payments. First-party clients implement
this M-2 option; the immutable contract still permits other callers to create
unlocked discounted invoices. The owner accepted that residual boundary.

## Acknowledgement, quote and financing

`POST /pay/:id/ack-request {buyer}` returns the exact onchain amount/due date,
buyer nonce and ten-minute typed-data digest. `POST /pay/:id/ack` accepts
`{buyer,deadline:number,signature:hex}` and confirms `ackedAt` after the receipt.
The buyer must match current storage. This is receipt/no-dispute evidence at
signing time, not a payment guarantee or an irrevocable legal waiver.

`GET /pay/:id/financing-quote` returns acknowledgement and the v2 buyer record,
including distinct on-time supplier addresses. Its advisory discount heuristic
is `max(100,500-min(distinct,10)*20-(acknowledged?100:0))` basis points. Distinct
addresses are not independently verified people; the output explicitly says so.
The merchant still chooses signed financing terms. Any invoice carrying early
payment discount terms is permanently refused for financing, even after expiry.

Listing challenges, funding authorization, certificate readback, refunds and
defaults select the invoice's original contracts. Investor approval accepts an
optional `contractVersion`; absent it uses the creation default. A fresh World
flow is required for a new registry, never a fabricated approval.

## Indexing and legacy subscriptions

V1 cursor names stay intact. V2 router/claim cursors include chain and contract
and start from their respective deployment blocks. The event journal key is
`(chain,contract,txHash,logIndex)`. Logs only affect invoices owned by that version.
`DiscountTermsSet` can precede `InvoiceCreated`; both read storage at the log's
block for payer lock/minimum/discount terms rather than infer missing fields.

Existing and newly signed subscription agreements continue using the original
manager. B2B replacement cancellation, renewal safety checks and inventory
release read the invoice's version; no manager address is swapped. A separately
deployed new manager remains inactive until agreement provenance is implemented.

Local tests and typechecks are not live redeployment evidence. The lead owns
staging migration, deployment, merchant signatures and the coordinated regression.
