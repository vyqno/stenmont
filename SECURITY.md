# Security

Stenmont is hackathon software running on a **test network with valueless test tokens**. It has had an independent review (summarised below) but no external audit. Do not use it with real money.

## Reporting a problem

Email **hello@stenmont.com** with the details, or open a private security advisory on GitHub. Please do not post exploits publicly before we have had a chance to fix them. We will reply as soon as we can; this is a small team, so there is no formal service level.

## What is in scope

The contracts in `contracts/src`, the API and relayer in `services/api`, the facilitator in `services/facilitator`, the web app in `apps/web` and the packages in `packages/`.

## How secrets are handled

- No secret is in the repository. `.env` is a local paste area and is ignored by git; `.env.example` lists names only.
- Real secrets live in Cloudflare (`wrangler secret`), per environment: the relayer, attester, faucet and ENS registrar keys, the World client secret and the session secret.
- API keys are stored only as SHA-256 hashes and are shown once. Session cookies are HttpOnly, Secure, SameSite=Lax and host-only; cookie-authenticated changes must come from our own origin.
- Passkey sign-in uses WebAuthn with user verification required, single-use challenges and a signature counter check.

## Review status

The independent review (see `plan/review-opus-1.md`) found no way to redirect a payment or take customer funds. Items it raised that are fixed: cancelling an invoice after it was sold, splitting a large refund to avoid approval, subscriptions that the merchant could not cancel onchain, unbounded invoice creation, overlapping renewal runs, a shared cookie domain, a re-broadcast risk in the sender, unbound idempotency keys, and API-key revocation.

## Known limitations

- Owner and guardian of every contract are one deployer wallet. A multisig is planned before any real value.
- The shared relayer can create invoices for any merchant that enabled delegation; the API pins the payout, the contract does not.
- Invoice creation, merchant activation and refunds do not yet draw down the merchant's gas tank (they are rate limited instead).
- Transactions that time out are not reconciled automatically.
- A lost passkey cannot be recovered yet. Tokens other than USDT sent to a passkey account cannot be moved (the account has no execute function).
- World ID proofs on the test network are mocked by World and must not be relied on for production.
- The contracts have not had a professional audit.

## Bounded Wave 2 review — 2026-11-06

A public-store reservation expiry could release inventory while its original invoice remained payable. The fix retains inventory until an unpaid, unhooked onchain cancellation is confirmed, with local payment/in-flight guards. Hosted expiry and uncertain states retain inventory for reconciliation. Investor and subscription clients also stop on insufficient owned USDT rather than requesting platform faucet funds. Targeted regressions and typechecks passed; live acceptance remains separate.

The review was partial and sequential. Dependency audit still reports five advisories; contract security, CSP, relayer timeout reconciliation and scheduled cleanup remain open. See [W10 evidence and limitations](docs/WAVE2-W10.md).
### Response guards

Minimal object/base/frame CSP guards, nosniff and private-route no-referrer rules are implemented and locally HTTP-tested. Broader script/style/connection CSP is explicitly Report-Only pending real identity/wallet/font compatibility proof; it does not block script injection. The install-proof scheduled cleanup handler is already wired. See [header evidence and limitations](docs/WAVE2-W10-HEADERS.md).
