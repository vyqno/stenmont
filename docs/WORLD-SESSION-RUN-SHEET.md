# Real World session: staging run sheet

Status: prepared from source; **not run**. The lead announces readiness and hands
control to sir at every World or device-authentication prompt. This sheet is not
an approval, a completed verification or transaction evidence.

## Preconditions: stop if any gate is missing

- The reviewed v2 API/web deployment, migration0071 receipt classification,
  contract wiring and source verification must be accepted. Retired v1 invoices
  stay on their actual router; no address replacement is a migration.
- API, web and MCP are staging only. The selected v2 router's actual
  `refundApprovalThreshold` and API `REFUND_APPROVAL_THRESHOLD` must both be
  `2000000` base units (2.00 USDT). Do not use the retired router for this proof.
- World IDKit configuration and World OIDC configuration are separate. The lead
  privately checks their configured names, permitted staging origins and callback
  `https://api-staging.stenmont.com/auth/world/callback`. No client secret, proof,
  QR payload, authorization URL, code, state, nonce, token or cookie enters this
  document, screenshots, chat or Git.
- Sir has his real eligible World App identity and device ready. No simulator,
  forged proof, attester shortcut or direct database change can close these gates.
  If World requires account/provider changes, stop for sir.
- Preserve the merchant's existing browser/passkey session. Use the current
  isolated merchant; do not repeatedly create accounts or spend abuse allowances.
  Fresh v2 creator delegation must have been signed through the normal UI.
- Recheck balances immediately before spending. The earlier snapshot showed the
  existing payer holding **2.392 test USDT** after the0.098 v2 payment; that is not a promise of today's
  balance. The investor UI uses an existing **checkout/investor passkey account**
  (`loadPasskey` / `ensureAccount`), not an EOA wallet. A deployer EOA balance
  cannot fund that account automatically, and the merchant's1.00 balance cannot
  be relabelled as investor funds. Reuse an already-funded retained investor
  passkey if one exists; otherwise stop for sir to supply at least0.95 test USDT
  to the actual selected investor account himself. No platform funding or new
  account without its required existing funds. The investor needs those funds,
  and
  the merchant needs the returned payment available for its refund. Gas tanks and
  relayer need sufficient WBT. No platform USDT funding, faucet or new bridge run.
- Resolve the UI retry gate before the denial/approval sequence: after
  `approval_denied` or `approval_expired`, the Refund action must offer a fresh
  World approval for the same exact refund params through `POST /v1/approvals`.
  The old button handled only `approval_required`. Do not call a denied row
  approved, edit rows, or spend another invoice just to work around this gap.
- Investor approval must pass the selected claim's `contractVersion:"v2"` to
  both World allow endpoints, rather than infer it from the creation default.
  Read back eligibility from the actual selected v2 registry after approval.

## Public entry points

| Purpose | URL |
|---|---|
| Merchant sign-in | https://app-staging.stenmont.com/login |
| Merchant World verification | https://app-staging.stenmont.com/dashboard/settings |
| Verification tier | https://app-staging.stenmont.com/dashboard/verification |
| Create, sell or refund an invoice | https://app-staging.stenmont.com/dashboard/invoices |
| Financing timeline | https://app-staging.stenmont.com/dashboard/financing |
| Investor market | https://app-staging.stenmont.com/invest |

For a selected invoice, the UI generates public `/pay/<invoiceId>`,
`/invest/<invoiceId>` and `/claim/<invoiceId>` paths on that same staging app.
Only paste the real public invoice paths after creation; never substitute a
customer account token or World callback URL. This sheet intentionally contains
no live access-bearing link.

## A. Verify the merchant with a real person

1. Open Settings as the retained merchant and locate **Verify your business** /
   **Verify with World ID**. The source uses action `enrol-business` and the
   Proof of Human preset. Confirm the merchant shown is the intended business.
2. Lead pauses and hands the real World interaction to sir. Sir completes it on
   his own device. Do not capture the QR or inspect credentials.
3. After return, check the Settings state and Verification page. The API's
   `/v1/world/status` should report enrollment and the computed tier should reach
   3 through the World route. A domain/email route alone does not meet financing
   tier3. An existing enrollment response is not a new real-person proof.
4. Record the time, displayed result and sanitized status only. On rejection,
   stop and preserve the error; do not replace it with a simulator result.

## B. Deny, then correctly approve a refund above 2.00 USDT

Use a dedicated **2.01 test-USDT** v2 invoice, without early-payment discount,
financing hook or instalment plan. Confirm its payer owns at least2.01. This
leaves0.382 from the latest2.392 snapshot until the refund is completed.

1. From Invoices, create that invoice through the dashboard, then open its public
   pay page. The existing payer signs the2.01 payment with its own funded account.
   Confirm receipt success, the onchain payment and the merchant's recorded paid
   amount before proceeding. This is a real test transaction, not a mock receipt.
2. Back in the merchant dashboard press **Refund**. Expected: no refund is sent;
   the UI requests human approval because2.01 exceeds2.00. The server works out
   the actual recipient and exact refund amount; do not modify those params.
3. Press **Approve with World**. The lead hands control to sir. Sir deliberately
   denies/cancels the real request in World. Return to the dashboard and record
   the denied result. Check the owning approval status and audit event, and verify
   that there is no refund transaction and paid/refunded balances are unchanged.
   Closing a tab without a callback is cancellation/pending evidence, not a
   completed on-server denied result; label it accurately.
4. Use the explicit **fresh approval** action for that same2.01 refund. This
   creates a new pending request; it does not reuse the denied approval. Sir now
   completes the fresh real World sign-in. Callback nonce, issuer, audience,
   signature, PKCE and `auth_time` must pass normal server verification.
5. Return to Invoices and press **Refund** again. Approval alone moves no money.
   The merchant still confirms the refund with its passkey; after its signed
   submit, require a successful receipt and the2.01 return to the original payer.
6. Record approval transition `approved → consumed`, refund transaction/explorer
   link and final invoice/refund totals. The approval lasts five minutes and its
   authentication must be no older than five minutes. If the passkey step is
   cancelled or expires after consumption, start another fresh approval; never
   extend timestamps or retry a consumed approval as authority.

The denied and allowed attempts must refer to the same operation, invoice,
amount and recipient. The2.01 refund restores the payer's funds for the later
1.00 invoice; verify that return before the next spend. If the balance has
changed or the refund cannot complete, stop for sir rather than fund a wallet.

## C. Dashboard sale, real investor approval, timeline and certificate

This is the valuable dashboard lifecycle. Do not repeat the earlier direct CLI
lifecycle or use the script's investor-allowlist shortcut.

1. On Invoices create a **1.00 test-USDT** v2 invoice with a due date comfortably
   more than one hour away. Name the buyer account. **Do not set early-payment
   discount terms:** those invoices are permanently ineligible for financing.
2. Optional acknowledgement proof: before payment, the nominated buyer opens the
   pay page, reads the invoice/delivery statement and voluntarily accepts using
   its existing passkey/wallet. This may only be done if the statement is true of
   the isolated test delivery. Require successful `ackedAt` readback and record
   the advisory quote before/after. No acknowledgement is fabricated or mandatory
   to sell. Distinct supplier addresses are not independent verified humans.
3. Merchant presses **Sell this invoice**, chooses5% investor discount and10%
   reserve, checks the quoted price0.95 / reserve0.10 / cash today0.85, then
   confirms the two genuine passkey challenges: terms and payout hook. Require
   the listed transaction and correct v2 router/claim provenance.
4. Open the corresponding public investor page. Reuse an existing investor
   **passkey** account with its own at least0.95 test USDT. An unrelated funded
   EOA or the merchant's balance does not satisfy this UI prerequisite. If there
   is no funded retained passkey, stop for sir to fund the selected investor
   account himself; do not transfer platform funds. If it is not already allowed on
   the actual v2 registry, **Buy** stays unavailable; record this refused gate.
5. Press **Verify with World ID**. Lead hands control to sir for the real
   `allow-investor` Proof of Human action. After normal verification, require the
   registry allow transaction and actual `isAllowed` readback. A displayed widget
   success or a grant on v1's registry alone is insufficient. This is a separate
   action from merchant enrollment and from refund OIDC approval.
6. Investor presses **Buy for0.95** and confirms its purchase signature. Require
   receipt success and the recorded advance/reserve. No real investor or external
   traction is implied: identify these as operator-controlled test roles.
7. The nominated buyer pays the1.00 invoice with its existing funds. Require
   success and indexed payment/settlement. Check investor receives1.00 total,
   merchant receives its0.10 reserve after its earlier0.85 advance, and the claim
   balance equals any remaining reserves plus deferred liabilities. Only claim
   zero after all required payouts actually succeed.
8. Open Financing and verify Listed / Investor verified / Funded / Customer pays /
   Settled steps with genuine transaction links. Open **Public certificate** and
   require chain-confirmed status, correct v2 claim contract, amounts and holder.
   Invoice number is hidden unless the merchant explicitly enables its checkbox.
9. Record public invoice, investor and certificate paths and actual explorer
   transactions. Default remains fork-tested until a separate real overdue claim
   actually passes the seven-day grace period; do not present it as run here.

## Completion record

For each section record: not run / blocked / passed / failed; real IST time;
public evidence paths; transaction hashes and receipt status; sanitized before /
after totals; exact test records created. A cancelled World interaction, local
fixture or HTTP200 must not be reported as successful real verification. Keep
sir's remaining gates together: real World interaction, his own existing test
funds if insufficient, unresolved provider configuration, pushes and the video.

## Source checks used to prepare this sheet

[World routes](../services/api/src/routes/world.ts),
[approval expiry and single-use gate](../services/api/src/world/approvals.ts),
[refund gate](../services/api/src/routes/refunds.ts),
[Refund UI](../apps/web/components/RefundButton.tsx),
[merchant World UI](../apps/web/app/dashboard/settings/page.tsx),
[Sell UI](../apps/web/components/SellButton.tsx),
[investor flow](../apps/web/app/invest/[invoiceId]/ClaimClient.tsx),
[financing routes](../services/api/src/routes/financing.ts),
[public certificate](../services/api/src/routes/publicClaims.ts), and
[versioned API interfaces](API-VERSION-ROUTING.md).
