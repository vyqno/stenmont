# Verification tiers

A business earns a trust tier from facts we already hold. The tier sets how much it may invoice, whether it may sell invoices, and whether it may invest. The tier is the highest route that currently holds (it is not a chain): the private route reaches tier 3 without an email and without any document.

| Tier | How | What it unlocks (demo defaults) |
|---|---|---|
| 0 | a passkey | invoices up to 100 USDT each, 500 USDT a day |
| 1 | confirmed email (`verification_records`, method `email`) | 500 each, 2,000 a day |
| 2 | verified domain (DNS TXT check on a registered site, or a `domain` record) | 2,000 each, 10,000 a day |
| 3 | World Proof of Human (no documents) | 10,000 each, 50,000 a day, sell invoices up to 5,000 |
| 4 | document check by a KYC/KYB provider | 1,000,000 each, 5,000,000 a day, sell up to 1,000,000, investor eligibility |

These numbers are **demo defaults** in `services/api/src/verification/tiers.ts`. They are not a risk decision. A row in the `verification_limits` table replaces the default for its tier. A malformed row is ignored.

## Where it is enforced

- Invoice creation and store checkout (`createInvoice`): per-invoice and rolling 24-hour caps. Refusal is `403 tier_limit` with `details.currentTier`, `details.nextTier` and `details.howToReach`.
- `POST /v1/financing/listings`: tier 3 or higher, and a face value within the tier's financing cap.
- `POST /invest/allow`: tier 4. The investor account must be the onchain account of a business whose document check is approved. (The attester-signed test path in `scripts/` does not go through the API and is unchanged.)

A record that carries an `expires_at` stops counting at that instant, so the tier falls back when it lapses.

## Documents: the KYC provider

`services/api/src/verification/kyc/provider.ts` defines the interface (`startCheck`, `parseWebhook` with signature verification, `mapDecision`). **Only a sandbox provider exists** (`mock.ts`). It never looks at a person or a document, it is off in production, and it needs `KYC_MOCK_WEBHOOK_SECRET`.

A real provider (Sumsub, Persona, Veriff or similar) needs the founder's account with that provider and a cost decision. It is **not integrated**. To add one, implement the interface in a new file and list it in `kycProvider`.

We store only the provider's reference for a check, its decision, a time and an expiry. We never receive, store or log documents or personal details. Every decision writes an `audit_log` row with the tier before and after.

The webhook (`POST /webhooks/kyc/:provider`) checks the signature and a five-minute timestamp window, applies each event id once, ignores events older than the record's last decision, and ignores references it does not know.

## Wallet sign-in (EIP-4361)

A wallet is another way to sign in to a business that already exists. It cannot create one, because the passkey is the only signer of the onchain account. A signed-in business links a wallet (`intent: "link"`); a linked wallet signs in (`intent: "login"`); an unknown wallet is told it is not linked and nothing is created. A wallet session can use the dashboard, but every onchain action still asks for the passkey.

The message must be exactly what a canonical writer produces for its fields, for this site's domain and origin, for the app's chain id, and no older than ten minutes. Each nonce works once and is spent before the signature is checked. Ordinary wallets are checked by signature recovery; smart accounts through ERC-1271 on the app's chain.

## ENS badge

The tier is published as the text record `stenmont.tier` on the business's ENS name. The platform's registrar writes it and nobody else: no role for that record is ever granted to the business, a team member or an agent (a test decodes the grants to prove it). `lockPayout` now also pre-grants the record to the registrar before its root rights are dropped. A name whose payout was locked before this change cannot receive the badge; the failure is recorded and nothing else breaks.
