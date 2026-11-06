# Lost-passkey payout recovery — design proposal

Status: design only. Email recovery restores read-only dashboard access and never replaces the key controlling an existing payout account. No contract changes or recovery transactions are authorized by this note.

## Boundary

A verified inbox, Google subject, World human proof or new dashboard session does not prove authority over an existing payout signer. Preserve the original passkey requirement for account activation and money actions. Do not silently create a replacement account and describe it as recovered funds.

## Proposed recovery model

Prefer a second passkey enrolled while the original signer is available. For complete loss, evaluate a contract-supported guardian flow with an owner-selected Safe, a public delay, cancellation by the existing signer, notifications to previously verified contacts and explicit proof of the new key. Guardian authority, threshold and the delay remain owner decisions. Email can notify and coordinate; email alone must never authorize a new signer.

Existing deployed accounts cannot acquire a new recovery capability through an email database edit. Determine upgradeability and account migration constraints first. A migration may require the still-available original key; do not promise recovery for accounts whose signing key is already lost.

## Required work before implementation

1. Inspect deployed account code and ownership; enumerate what is technically recoverable without the old key.
2. Obtain the intended guardian/Safe address from Hitesh and verify chain, threshold and ownership.
3. Specify enrol, request, delay, cancel and execute signatures, chain/domain binding, nonce, expiry and replay protection.
4. Test unauthorized enrolment, compromised inbox, colluding guardian, wrong chain/key, cancellation races, frozen recovery and repeated execution. Keep money-path coverage and invariant/fork tests.
5. Write a coordinated staging deployment/migration plan for every affected account/factory/router integration, regenerate shared ABIs and verify source and wiring.
6. Demonstrate original-key cancellation and a valid delayed recovery on staging with externally supplied test funds. Record exact addresses and receipts.
7. Make no production claim or production change without separate written owner authorization.

Until those gates pass, the product must say: “Email can restore dashboard access. A lost payout passkey cannot currently be replaced.”
