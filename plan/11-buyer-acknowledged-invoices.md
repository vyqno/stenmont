# Buyer-acknowledged invoices — design note

Status: proposal only, 6 November 2026. No contracts or financing screens changed. This is independent of the tokenization timeline and public claim certificate owned by other agents.

## Intent

Give investors evidence that a buyer accepted an invoice and acknowledged delivery. A verified acceptance may justify a lower financing discount because the dispute uncertainty is reduced. It is not a payment guarantee, credit score, insurance, escrow or waiver of statutory rights. Payers bring their own USDT. Stenmont's contracts do not hold customer money in escrow.

## Signed evidence

Use two explicit EIP-712 actions: `AcceptInvoice` and `AcknowledgeDelivery`. Each binds the buyer account, supplier account, chain ID, router and invoice ID, a canonical invoice-content hash, content version, acceptance type, nonce and expiry. Delivery adds a delivery-evidence hash and a human-readable evidence summary. Domain separation includes the Stenmont evidence-verifier version. The UI must present the actual amount, currency, goods/services, due date, delivery evidence and consequence before signing.

The buyer is the invoice's nominated buyer, not any person who happens to know the link. Verify EOA signatures and EIP-1271 smart-account signatures against the correct chain. Passkey accounts still require their valid signing assertion. World may establish distinct-human eligibility; it does not establish purchase authority or prove delivery. Never infer acceptance from an email open, page view, payment or supplier statement.

Store the canonical payload, signature, signer, verification time, domain and version in an append-only evidence record. Invoice modification invalidates eligibility for the previous version; do not edit signed evidence. Enforce unique nonces, finite expiry and exact invoice ownership. Require a new buyer acceptance for material changes. Support an explicit disputed/withdrawn state with an auditable timestamp. Acknowledgement data is private by default; publish only hashes with consent and never product details or customer email.

## Discount rule

Proposal: supplier chooses a base discount and an optional lower accepted-delivery discount, both subject to platform bounds. No numerical reduction is approved. The lower discount is eligible only when both current invoice acceptance and delivery acknowledgement are valid, unexpired and undisputed. Show investors both prices, evidence state and the reason for the active price. Acknowledgement is a risk signal, not a guarantee of future payment.

A funded claim retains the terms signed at funding. Later evidence cannot silently change an investor's purchased return. An invalidated acceptance removes lower-price eligibility for future funding. The supplier cannot nominate itself as buyer; organizational authority and related-party risk remain explicit limitations.

## Implementation boundary

First implement offchain typed evidence, verification and audit APIs with fixtures. Do not claim a contract-enforced discount when the deployed claim contract merely accepts supplier-signed listing terms. Before money-changing integration, decide whether the lower-price eligibility must be enforced onchain. If it must, a verifier or claim-contract update and coordinated redeployment are required.

## Redeployment plan required before contract changes

1. Specify new verifier/claim interfaces, role ownership and the evidence revocation race at funding.
2. Write tests for forged/wrong-chain/wrong-invoice/expired/replayed signatures, contract-wallet validation, invoice version changes, duplicate acknowledgements, related parties and concurrent invalidation/funding.
3. Pin current deployments and state; document treatment of existing listings and funded claims without changing their terms.
4. Run unit, fuzz, invariant, official-USDT fork tests and security review.
5. Deploy the coordinated router, subscription and financing bundle on staging as required by the repository architecture; regenerate shared ABIs and addresses and verify wiring and explorer source.
6. Run a buyer acceptance → delivery acknowledgement → discounted funding → payer payment → holder settlement lifecycle using externally supplied test funds. Record independent receipts and a denied/replayed case.
7. Obtain explicit owner approval for any later production work. This note does not authorize contract edits or any deployment.

## Acceptance before shipping

Buyer can inspect and sign each exact version. Supplier cannot forge or transfer buyer authority. Investor can independently verify evidence and signed funding terms. No customer money is locked by acknowledgement. All invalid, expired, replayed or disputed evidence fails closed. No discount or settlement claim is made from a conceptual certificate or UI badge.
