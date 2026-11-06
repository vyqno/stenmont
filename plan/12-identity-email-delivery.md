# Identity sign-in and transactional delivery

## Approved scope

Email and Google restore read-only dashboard access after the identity has been explicitly linked from a passkey-authenticated business session. The owner approved dashboard recovery on 6 November 2026; lost-passkey payout recovery is deferred. No recovery endpoint replaces the onchain signer or grants write-capable OAuth consent from a recovered session.

Email uses an eight-digit cryptographic code, HMAC-SHA-256 with a server-only pepper, ten-minute expiry, five guesses, single atomic consumption and IP/address rate limits. Only the hash is persisted. The code and recipient must never be printed. A verified identity with no business association cannot access another business by matching email.

Google uses authorization code + S256 PKCE, browser-bound state, nonce, pinned token/JWKS endpoints, server signature/audience/issuer/expiry validation and strict email_verified. Identity key is provider + sub. Both Google issuer forms are accepted. auth_time is optional only for the Google verifier; World keeps its existing freshness gate. Google-created identity remains unlinked until the business passkey session explicitly links it. No Google client has been created or configured here; live Google verification is not run.

Turnstile protects registration options and account activation server-side, including expected hostname and action. Production rejects public dummy site/secret keys and dummy tokens before any provider response can authorize them. Local/unit fixtures may omit configuration; staging and production fail closed when configuration is missing. Cloudflare dummy validation returns example.com without an action; only a configured nonproduction dummy secret with the exact dummy token accepts that documented shape. Real-key validation still checks action and hostname. A fresh widget token is requested for each action; a signup token is not reused for activation.

## Email and safe testing

Templates exist for receipt, invoice, reminder, refund, payout notice, large-refund review and email codes, each with plain text and accessible HTML. New-brand colours are used only in email; app theme remains legacy. The textual sender name is not a fabricated custom wordmark. Email clients use explicit Helvetica/Arial system fallbacks: no font binary or unverifiable remote commercial font is distributed in email.

Cloudflare structured Email Sending uses the EMAIL binding and send({from,to,subject,html,text}). EMAIL_MODE defaults to sink. Local tests inject a sink binding and assert recipient safety and no real send. Live delivery requires an explicitly configured binding, onboarded sender domain and owner approval. Never enable EMAIL_MODE=live while testing against real recipients.

The transaction templates are a rendering/delivery interface. Confirmation templates must be called only after the matching confirmed event; a generic request or pending transaction must not issue a receipt. Automated transaction-event dispatch is not implied by template tests.

## DNS inspection, 6 November 2026

Read-only dig queries returned:

- Root SPF: v=spf1 include:_spf.mx.cloudflare.net ~all.
- DMARC at _dmarc.stenmont.com: v=DMARC1; p=reject;.
- DKIM TXT at cf2024-1._domainkey.stenmont.com: an RSA public key was present.
- cf-bounce.stenmont.com also returned the Cloudflare SPF include.

This establishes DNS presence at the queried names. It does not establish that Email Sending is onboarded, that its actual selector/return-path aligns, or that an actual message passes authentication. No real message was sent. Recheck the Email Sending domain dashboard and actual message headers against the selected sender before enabling delivery.

## Sources

- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/

## Deployment gate

Apply migration 0023 on staging before deploying code that reads identity tables. Configure a random EMAIL_CODE_SECRET without printing it. Configure staging-only dummy Turnstile keys for automated checks; production keys are never deployed by this task. Keep EMAIL_MODE=sink. Do not deploy incomplete sign-in configuration that would block existing signup. Use fixtures for Google until the owner supplies a client. No production migration, deploy or confirmation variable is permitted.
