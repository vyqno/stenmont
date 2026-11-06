# Real staging dataset preparation

The helper prepares a small repeatable dataset through the public merchant API. It never edits D1 rows, creates fake paid statuses, generates wallets, funds a payer or bypasses a signature.

```bash
pnpm --filter @stenmont/scripts seed-demo
```

Default dry-run is entirely local: no API key, requests or writes. It describes three products, open and past-due invoices, one B2B three-part invoice offer and one ordinary subscription offer. The default namespace/date are pinned to the hackathon demo; choose stable values for another run.

After the lead has created or signed in to an isolated merchant with a real passkey and configured its existing API key in `STENMONT_API_KEY` (never a CLI argument):

```bash
pnpm --filter @stenmont/scripts seed-demo --namespace demo-20261106 --as-of 2026-11-06 --confirm
```

Only `https://api-staging.stenmont.com` is accepted. The merchant identity comes from `/v1/me`. Product handles/SKUs are namespace-bound; existing prices are compared in USDT base units, existing stock is preserved, and a mismatch stops without overwriting a product. Products are paginated before creation. Invoices and the subscription use deterministic merchant/namespace/date/resource idempotency keys. Repeating the exact run reuses the same resources; changing the pinned date or namespace intentionally creates another dataset.

The helper reads each invoice/subscription again after creation or idempotent replay, so the report reflects its current state rather than the cached creation response. A network timeout is not retried with a fresh key. Rerun the same namespace/date to reconcile through the API's own idempotency path. A partially created catalogue record needs inspection; the helper refuses to conceal or overwrite it.

Still required for a complete demo dataset:

- Merchant activation/sign-in uses the browser passkey flow; the seed does not replace it.
- The payer must make real partial/full test-USDT payments; refunds require the merchant's normal confirmation. No payment status is assigned by this script.
- Financing requires the dashboard listing signatures, eligibility and investor funding. World verification is a real separate gate.
- An active subscription/replacement requires payer permit and agreement signatures. This helper creates offers only.
- ENS business and agent names require the normal registrar/permission flow; no guessed address or synthetic resolved name is created here.

Local tests exercise restart, canonical API price shapes, current-state reads, namespace key separation, mismatched existing catalogue, exact staging-origin enforcement and uncertain-send refusal. No live seed run is claimed until the lead executes it and records the resulting IDs and transactions. Keep the number of real runs low because platform gas and staging abuse limits are real.
